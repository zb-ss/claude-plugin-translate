---
description: Fully automatic Joomla component translation workflow with parallel batch processing
---

# Auto Translation Workflow (Parallel Orchestrator)

Automatically translate an entire Joomla component by processing view files in parallel batches.

## AGENTIC MODE ACTIVE

This workflow runs in **agentic mode** with expanded permissions:

**ALLOWED without asking:**
- Read/Write/Edit PHP and INI files
- Create feature branches for translation work
- Run `php -l` validation after edits
- Create workflow state files in `~/.claude/workflows/`
- Spawn executor agents for parallel processing

**BLOCKED (user does manually):**
- `git commit` - User reviews translations first
- `git push` - User pushes when ready

**Branch naming:** `feature/translate/{component}-{lang}` (e.g., `feature/translate/com-lots-fr-ca`)

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

## Examples

```
/translate:auto /var/www/joomla/administrator/components/com_lots fr-CA
/translate:auto ./components/com_inventory es-ES --dry-run
/translate:auto /path/to/com_mycomp de-DE --resume
```

---

## DELEGATION — Spawn Orchestrator as Sonnet Subagent

When this skill is invoked, you MUST immediately delegate the entire orchestration to a **sonnet** subagent. Do NOT run the orchestration loop yourself.

1. Parse the arguments (`componentPath`, `targetLanguage`, flags like `--dry-run`, `--resume`, `--skip-review`)
2. Spawn a single Task agent with:
   - **Agent type**: `translation-coder`
   - **Model**: `sonnet`
   - **max_turns**: `50`
   - **Prompt**: Include the FULL orchestrator instructions below, substituting the parsed arguments

The orchestrator subagent will then spawn its own executor subagents for each view.

Your only job after delegation is to relay the final summary back to the user.

---

## CRITICAL ORCHESTRATOR RULES

You are the **ORCHESTRATOR**. You coordinate the workflow but **NEVER process views directly**.

### You MUST NOT:
- Call `i18n_hardcode_finder` yourself
- Call `i18n_convert` yourself
- Call `file_chunker` or `chunk_reader` yourself
- Directly edit any PHP view files

### You MUST:
- Use `workflow_translate_next_batch` to get batches of views
- Spawn executor agents (via Task tool) to process views in parallel
- Collect INI entries from executor results
- Call `ini_builder` yourself (sequentially, never in parallel)
- Call `workflow_translate_view_done` and `workflow_translate_review` yourself

---

## Workflow Steps

### Step 1: Initialize

1. Call `workflow_translate_init(componentPath, targetLanguage)`
2. Create a feature branch: `feature/translate/{component}-{lang}`
3. Note the `workflowId`, `sourceIniPath`, `targetIniPath`, total views count

### Step 2: Batch Processing Loop

Repeat until all views are processed:

#### Phase 1 — Get Batch

Call `workflow_translate_next_batch(batchSize=4)`.

If response has `complete: true`, go to Step 3 (Finalize).

#### Phase 2 — Spawn Parallel Executors

For each view in the batch, spawn an executor agent using the Task tool:

- **Agent type**: `translation-coder`
- **Model**: `sonnet`
- **Run in background**: `true` for batches of 2+, `false` for single view (process inline)
- **max_turns**: `25` for small files (<500 lines, no chunking), `35` for large files (needs chunking)
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

#### Phase 5 — Mark Views Done

For each view in the batch:

1. Call `workflow_translate_view_done(workflowId, viewPath, stringsFound, stringsConverted, errors)`
2. Call `workflow_translate_review(workflowId, viewPath, passed=true)` (or `false` if errors)

Then loop back to Phase 1 for the next batch.

### Step 3: Finalize

Generate a summary report:

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

### 5. Return Results

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
| Executor (small) | 25 | File <500 lines, no chunking |
| Executor (large) | 35 | File needs chunking |

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
