---
description: Fully automatic Joomla component translation workflow with parallel batch processing
---

# Auto Translation Workflow (Parallel Orchestrator)

Automatically translate an entire Joomla component by processing view files in parallel batches.

## AGENTIC MODE ACTIVE

This workflow runs in **agentic mode** with expanded permissions:

**ALLOWED without asking:**
- Read/Write/Edit PHP and INI files
- Run `php -l` validation after edits
- Create workflow state files in `~/.claude/workflows/`
- Spawn executor agents for parallel processing

**BLOCKED (user does manually):**
- `git commit` - User reviews translations first
- `git push` - User pushes when ready

---

## Arguments

$ARGUMENTS

**Required:**
- `<component_path>` - Path to the Joomla component directory
- `<target_language>` - Target language code (e.g., fr-CA, es-ES, de-DE)

**Optional:**
- `--dry-run` - Analyze without making changes
- `--skip-review` - Skip the review step after each view
- `--resume` - Resume from last incomplete view
- `--joomla-url <url>` - Joomla admin URL for browser verification (e.g., http://localhost/administrator)
- `--joomla-user <user>` - Joomla admin username
- `--joomla-password <pass>` - Joomla admin password
- `--skip-browser` - Skip browser verification step

## Examples

```
/translate:auto /var/www/joomla/administrator/components/com_lots fr-CA
/translate:auto ./components/com_inventory es-ES --dry-run
/translate:auto /path/to/com_mycomp de-DE --resume
```

---

## EXECUTION MODE — Run Orchestration Directly

When this skill is invoked, you ARE the orchestrator. Run the orchestration loop directly in this conversation — do NOT delegate to a subagent. This ensures the user sees all progress in real-time.

1. Parse ALL arguments:
   - **Required**: `componentPath`, `targetLanguage`
   - **Flags**: `--dry-run`, `--resume`, `--skip-review`, `--skip-browser`
   - **Browser verification**: `--joomla-url <url>`, `--joomla-user <user>`, `--joomla-password <pass>`
2. Obtain the `session_id` from the current session context (it is available via the SessionStart hook's `additionalContext` or from the hook input)
3. Follow the Workflow Steps below directly, calling MCP tools and spawning executor subagents as instructed.

---

## CRITICAL ORCHESTRATOR RULES

You are the **ORCHESTRATOR**. You coordinate the workflow but **NEVER process views directly**.

### You MUST NOT:
- Call `i18n_hardcode_finder` yourself (EXCEPTION: hardcode-sweep and completion-guard agents call it)
- Call `i18n_convert` yourself
- Call `file_chunker` or `chunk_reader` yourself
- Directly edit any PHP view files

### You MUST:
- Use `workflow_translate_next_batch` to get batches of views
- Spawn executor agents (via Task tool) to process views in parallel
- Collect INI entries from executor results
- Call `ini_builder` yourself (sequentially, never in parallel)
- After each batch, run per-view hardcode-sweep verification. For ANY view with remaining hardcoded strings, spawn a targeted fix agent and re-verify (retry loop, max 3 attempts per view, escalate to opus on attempt 3)
- After ALL views processed, run completion-guard agent (opus) for final zero-tolerance verification
- Call `workflow_translate_view_done` and `workflow_translate_review` yourself based on verification results

---

## Workflow Steps

### Step 1: Initialize

1. Call `workflow_translate_init(componentPath, targetLanguage, sessionId, joomlaUrl, joomlaUser, joomlaPassword)` — pass the sessionId received from the delegation prompt
2. Note the `workflowId`, `sourceIniPath`, `targetIniPath`, total views count

### Step 2: Batch Processing Loop

Repeat until all views are processed:

#### Phase 1 — Get Batch

Call `workflow_translate_next_batch(workflowId=<workflowId>, batchSize=4)`.

**CRITICAL**: Always pass `workflowId` explicitly to EVERY workflow tool call (`workflow_translate_next_batch`, `workflow_translate_view_done`, `workflow_translate_review`, `workflow_translate_status`, `workflow_translate_gate_update`). Never rely on auto-detection — multiple concurrent workflows may be active.

If response has `complete: true`, go to Step 3 (Completion Guard).

#### Phase 2 — Spawn Parallel Executors

For each view in the batch, spawn an executor agent using the Task tool:

- **Agent type**: `general-purpose`
- **Model**: `sonnet`
- **Run in background**: `true` for batches of 2+, `false` for single view (process inline)
- **max_turns**: `30` for small files (<500 lines, no chunking), `40` for large files (needs chunking)
- **Prompt**: Use the executor prompt template below, filled with view-specific data. Do NOT add extra commentary or context beyond the template — keep prompts lean.

**IMPORTANT**: Spawn ALL executors in a single message (parallel tool calls). Do NOT wait for one to finish before spawning the next.

#### Phase 3 — Collect Results

Wait for all background executors to complete. Each executor returns a JSON result with:
```json
{
  "viewPath": "/path/to/view.php",
  "stringsFound": 15,
  "stringsConverted": 14,
  "sourceEntries": [{"key": "COM_FOO_LABEL", "value": "English text"}],
  "targetEntries": [{"key": "COM_FOO_LABEL", "value": "Translated text"}],
  "errors": []
}
```

#### Phase 4 — Merge INI Entries (Sequential)

After ALL executors in the batch complete:

1. Collect all `sourceEntries` from all executor results
2. Collect all `targetEntries` from all executor results
3. Call `ini_builder(action="add", filePath=sourceIniPath, entries=<all source entries>)` — single atomic call
4. Call `ini_builder(action="add", filePath=targetIniPath, entries=<all target entries>)` — single atomic call

**NEVER call ini_builder in parallel. Always sequential.**

#### Phase 5 — Per-View Enforcement Loop

After all executors in the batch complete and INI entries are merged, run the enforcement loop for EACH view in the batch:

**Step 5a: Hardcode Sweep**

Spawn a hardcode-sweep verification agent:
- **Agent type**: `translate:hardcode-sweep`
- **Model**: `sonnet`
- **max_turns**: `15`
- **Run in background**: `false` (process sequentially per view)
- **Prompt template**:

```
Verify this translated view file for remaining hardcoded strings.

filePath: {view.path}
componentName: {componentName}

Return JSON with passed/failed and findings.
```

**Step 5b: Handle Sweep Result**

Parse the JSON result from hardcode-sweep:

- If `passed === true`:
  - Call `workflow_translate_view_done(workflowId, viewPath, stringsFound, stringsConverted, [])`
  - Call `workflow_translate_review(workflowId, viewPath, passed=true)`
  - Move to next view

- If `passed === false`:
  - Enter the **Fix & Re-verify Loop** (Step 5c)

**Step 5c: Fix & Re-verify Loop**

```
fix_attempt = 0
max_fix_attempts = 3

while fix_attempt < max_fix_attempts:
    fix_attempt++

    # Determine model for fix agent
    fix_model = "sonnet"
    if fix_attempt == 3:
        fix_model = "opus"  # Escalate on final attempt

    # Spawn targeted fix agent with EXACT findings
    Task(
      subagent_type="general-purpose",
      model=fix_model,
      max_turns=20,
      prompt="""
      You are a TARGETED FIX agent. Fix ONLY the specific hardcoded strings listed below.

      ## FILE TO FIX
      {view.path}

      ## COMPONENT
      com_{componentName}

      ## EXACT ISSUES TO FIX (from hardcode-sweep)
      {JSON list of findings from sweep result}

      ## INSTRUCTIONS
      For EACH finding:
      1. Read the file at the specified line
      2. Replace the hardcoded text with Text::_('COM_{COMPONENT}_{TYPE}_{DESCRIPTOR}')
      3. Ensure `use Joomla\CMS\Language\Text;` import exists
      4. Run `php -l {view.path}` to validate syntax

      ## RETURN
      Return ONLY valid JSON:
      {
        "viewPath": "{view.path}",
        "fixed": <number of strings fixed>,
        "newSourceEntries": [{"key": "COM_X_Y", "value": "English text"}],
        "newTargetEntries": [{"key": "COM_X_Y", "value": "Translated text"}],
        "errors": []
      }

      ## TRANSLATION RULES FOR {targetLanguage}
      {include same language-specific rules as executor template}
      """
    )

    # Merge any new INI entries from fix agent
    if fix_result has newSourceEntries:
        ini_builder(action="add", filePath=sourceIniPath, entries=newSourceEntries)
        ini_builder(action="add", filePath=targetIniPath, entries=newTargetEntries)

    # Re-run hardcode sweep
    Task(
      subagent_type="translate:hardcode-sweep",
      model="sonnet",
      max_turns=15,
      prompt="Verify: filePath={view.path}, componentName={componentName}"
    )

    if sweep_result.passed:
        # Success! Mark view as done
        workflow_translate_view_done(workflowId, viewPath, stringsFound, stringsConverted, [])
        workflow_translate_review(workflowId, viewPath, passed=true)
        break

    if fix_attempt == max_fix_attempts:
        # All retries exhausted
        workflow_translate_view_done(workflowId, viewPath, stringsFound, stringsConverted, sweep_result.findings)
        workflow_translate_review(workflowId, viewPath, passed=false, issues=sweep_result.findings)
        # Log for manual fix
```

After processing all views in the batch, loop back to Phase 1 for the next batch.

### Step 3: Completion Guard

Before finalizing, run the completion guard agent (opus) to verify ALL translated files:

```
Task(
  subagent_type="translate:completion-guard",
  model="opus",
  max_turns=30,
  prompt="""
  Final verification of ALL translated files.

  viewPaths: {list of ALL view paths}
  componentPath: {componentPath}
  componentName: {componentName}
  targetLanguage: {targetLanguage}
  sourceIniPath: {sourceIniPath}
  targetIniPath: {targetIniPath}
  """
)
```

**Handle Completion Guard Result:**

```
guard_attempt = 0
max_guard_attempts = 3

while guard_attempt < max_guard_attempts:
    guard_attempt++

    # Run completion guard
    Task(
      subagent_type="translate:completion-guard",
      model="opus",
      max_turns=30,
      prompt="""
      Final verification of ALL translated files.

      viewPaths: {list of ALL view paths}
      componentPath: {componentPath}
      componentName: {componentName}
      targetLanguage: {targetLanguage}
      sourceIniPath: {sourceIniPath}
      targetIniPath: {targetIniPath}
      """
    )

    if guard_result.approved:
        workflow_translate_gate_update(workflowId, "completion_guard", "passed")
        break

    if guard_attempt < max_guard_attempts:
        # Fix issues and retry
        Task(
          subagent_type="general-purpose",
          model="opus",
          max_turns=25,
          prompt="""
          Fix ALL remaining hardcoded strings found by the completion guard.

          Issues: {guard_result.issues}

          For each issue, fix the hardcoded text in the file, add INI entries,
          validate PHP syntax.

          Return JSON with fixed count and new INI entries.
          """
        )

        # Merge any new INI entries

if NOT approved after max_guard_attempts:
    Log for manual intervention
```

Then proceed to Step 3.5 (Browser Verification).

### Step 3.5: Browser Verification (Optional)

After the completion guard passes, run browser-based verification IF a Joomla URL was provided.

**If `--skip-browser` flag is set OR no joomlaUrl configured:**
```
workflow_translate_gate_update(workflowId, "browser_verify", "skipped")
```
Skip to Step 4.

**Otherwise, run browser verification:**

```
browser_attempt = 0
max_browser_attempts = 2

while browser_attempt < max_browser_attempts:
    browser_attempt++

    Task(
      subagent_type="translate:browser-verify",
      model="sonnet",
      max_turns=25,
      prompt="""
      Browser verification of translated Joomla views.

      joomlaUrl: {browserVerifyConfig.joomlaUrl}
      adminUser: {browserVerifyConfig.adminUser}
      adminPassword: {browserVerifyConfig.adminPassword}
      targetLanguage: {targetLanguage}
      componentName: {componentName}
      viewPaths: {list of ALL view relativePaths}
      """
    )

    if browser_result.passed:
        workflow_translate_gate_update(workflowId, "browser_verify", "passed")
        break

    if browser_attempt < max_browser_attempts:
        # Try to fix issues found
        for issue in browser_result.issues:
            if issue.type == "raw_key":
                # Missing INI entry — add it
                Task(subagent_type="general-purpose", model="sonnet", max_turns=15,
                    prompt="Fix missing translation key {issue.text} for com_{componentName}...")
            elif issue.type == "english_text" or issue.type == "console_error":
                Task(subagent_type="general-purpose", model="opus", max_turns=20,
                    prompt="Fix translation issue in {issue.viewUrl}: {issue details}...")

        # Merge any new INI entries from fix agents

if NOT passed after max_browser_attempts:
    workflow_translate_gate_update(workflowId, "browser_verify", "failed")
    # Browser issues are BLOCKING — workflow will NOT be marked complete
    # Report all unresolved issues to the user for manual intervention
```

**IMPORTANT**: If browser verification fails after all retry attempts, the workflow stays in `browser_verification` status (not `complete`). The user must manually fix remaining issues and re-run, or explicitly skip with `--skip-browser`.

Then proceed to Step 4 (Finalize).

### Step 4: Finalize

1. Call `i18n_verify(componentPath, targetLanguage)` to validate INI key completeness across the whole component
2. Note any missing keys or orphan keys from the verification result
3. Generate the summary report:

```
================================================================
                    TRANSLATION COMPLETE
================================================================

Component: com_{name}
Target Language: {lang}

VIEWS PROCESSED
----------------------------------------------------------------
Total Views: {N}
  Completed: {N}
  Failed: {N}

STRINGS CONVERTED: {N}

INI FILE UPDATES
----------------------------------------------------------------
{source}.ini: +{N} keys
{target}.ini: +{N} keys

VERIFICATION RESULTS
----------------------------------------------------------------
  Per-view hardcode sweeps: {N} passed, {N} failed (retried)
  Completion guard: {passed/rejected}
  Final approval: {yes/no}

BROWSER VERIFICATION
----------------------------------------------------------------
  Status: {passed/failed/skipped}
  Pages checked: {N}
  Raw keys found: {N}
  Console errors: {N}
  Attempts: {N}

RETRIES & ESCALATIONS
----------------------------------------------------------------
  Views retried: {N}
  Escalated to opus: {N}
  Max attempts reached: {N} (manual fix needed)
  Completion guard cycles: {N}

WARNINGS (from i18n_verify)
----------------------------------------------------------------
  Missing keys: {N}
  Orphan keys: {N}
================================================================
```

---

## Executor Agent Prompt Template

Use this template when spawning executor agents. Replace all `{placeholders}`.

```
You are a translation executor agent. Process EXACTLY ONE view file for Joomla i18n translation.

## YOUR TARGET
- **File**: {view.path}
- **Component**: com_{componentName}
- **Lines**: {view.lines}
- **Needs chunking**: {view.needsChunking}

{IF view.attempt > 1}
## RETRY ATTEMPT {view.attempt}/3
Previous attempt failed verification. Errors: {view.previousErrors}
Scan the ENTIRE file from scratch — do not assume prior work was correct.
{ENDIF}

## WHAT YOU MUST DO

### 1. Detect Hardcoded Strings

{IF view.needsChunking}
This is a LARGE file ({view.lines} lines). You MUST use chunking:
1. Call file_chunker(filePath="{view.path}", chunkSize=150, overlap=20)
2. For EACH chunk returned, call i18n_hardcode_finder(filePath="{view.path}", startLine=X, endLine=Y)
3. Combine all findings, remove duplicates from overlap regions
{ELSE}
Call i18n_hardcode_finder(filePath="{view.path}") to detect all hardcoded strings.
{ENDIF}

### 2. Convert Each String

For EACH hardcoded string found, call i18n_convert to replace it in the PHP file:
- Use Joomla Text::_() for PHP strings
- Use Joomla.Text._() for JavaScript strings
- Key format: COM_{COMPONENT}_{TYPE}_{DESCRIPTOR}

### 3. DO NOT Call ini_builder

You MUST NOT call ini_builder. Instead, collect all INI entries and return them in your output.

### 4. Validate PHP Syntax

Run: php -l {view.path}
If syntax error, fix it before returning.

### 5. Self-Verify — Re-scan for Remaining Strings

Run i18n_hardcode_finder on the file again.
If summary.total > 0: convert remaining strings, validate syntax, re-scan.
Repeat up to 2 re-scan cycles. Proceed only when clean or cycles exhausted.

### 6. Return Results

Your final message MUST be valid JSON (and ONLY JSON, no other text):
```json
{
  "viewPath": "{view.path}",
  "stringsFound": <number>,
  "stringsConverted": <number>,
  "sourceEntries": [{"key": "COM_X_Y", "value": "English text"}, ...],
  "targetEntries": [{"key": "COM_X_Y", "value": "Translated text"}, ...],
  "errors": ["error message if any"]
}
```

## TRANSLATION RULES FOR {targetLanguage}

{IF targetLanguage == "fr-CA"}
- Formal "vous" (never "tu")
- Space before : ; ? !
- Use « guillemets français »
- "courriel" not "email", "téléverser" not "uploader"
{ELSEIF targetLanguage == "es-ES"}
- Use ¿ and ¡ for questions/exclamations
- Formal "usted" for admin interfaces
{ELSEIF targetLanguage == "de-DE"}
- Capitalize all nouns
- Formal "Sie"
- Compound words where appropriate
{ENDIF}

## CONTEXT EFFICIENCY
- For files >200 lines, use `Read(filePath, offset=X, limit=Y)` to read sections instead of the whole file
- Write/persist changes after each `i18n_convert` call — do NOT accumulate multiple changes before writing
- Minimize re-reads: take notes on line numbers and structure, reference notes instead of re-reading
- Keep output minimal — return ONLY the final JSON result, no verbose logging or commentary

## CRITICAL RULES
- Process ONLY {view.path} — no other files
- DO NOT call ini_builder — return entries as JSON
- DO NOT call workflow_translate_view_done or workflow_translate_review
- Your output MUST be parseable JSON
```

---

## Edge Cases

### Single View Remaining

If `workflow_translate_next_batch` returns only 1 view, spawn a single executor (not in background) to avoid overhead. Still collect its result and merge INI entries the same way.

### Executor Failure

If an executor returns errors or no valid JSON:
1. Log the error
2. Call `workflow_translate_view_done` with the errors
3. Call `workflow_translate_review(passed=false, issues=<error>)`
4. The view will be retried in a future batch (up to 3 attempts)

### Large File Mix

Batches may contain a mix of small and large files. All executors use **sonnet** regardless of file size for consistent quality.

---

## Context Resilience

### Executor Context Exhaustion

If an executor's output contains "context limit", is truncated, or returns empty/unparseable results:
1. Treat it as a failure
2. Call `workflow_translate_review(passed=false, issues="context limit exhausted")`
3. The view will be retried in the next batch (up to 3 attempts per existing retry logic)

### Orchestrator Result Minimization

When reading executor results via `TaskOutput`:
- Extract ONLY the final JSON block from the output
- Do NOT accumulate or reference full executor conversation histories
- Parse the JSON, store the structured data, discard everything else

### Progress Persistence & Recovery

- INI entries are merged immediately after each batch — this is the save point
- Each completed view is tracked via `workflow_translate_view_done` calls
- If the orchestrator itself hits a context limit, the workflow state persists
- A `--resume` invocation picks up from the last incomplete view automatically

### max_turns Budget

| Agent | max_turns | When |
|-------|-----------|------|
| Orchestrator | 50 | Always |
| Executor (small) | 30 | File <500 lines, no chunking (+5 for self-verify loop) |
| Executor (large) | 40 | File needs chunking (+5 for self-verify loop) |
| Hardcode sweep | 15 | Per-view verification |
| Targeted fix | 20 | Fix specific findings from sweep |
| Targeted fix (opus) | 20 | Escalated fix on 3rd attempt |
| Completion guard | 30 | Final opus verification of ALL files |
| Browser verify     | 25  | Browser-based verification of all views           |
| Browser fix        | 15-20 | Fix issues found by browser verify              |

---

## Language-Specific Rules

### French Canadian (fr-CA)
- Formal "vous"
- Space before : ; ? !
- « guillemets français »
- courriel, téléverser, etc.

### Spanish (es-ES)
- ¿ and ¡ for questions/exclamations
- Formal "usted" for admin interfaces

### German (de-DE)
- Capitalize all nouns
- Compound words
- Formal "Sie"

---

## Notes

- Maximum 4 parallel executors per batch (MCP server enforces this)
- INI files are NEVER written by executors — only the orchestrator writes INI
- PHP files CAN be edited by executors in parallel (different files, no conflicts)
- Always test in a development environment first
- Use `--dry-run` first to see what would be changed
