---
description: Fully automatic Joomla component translation workflow with progress tracking
---

# Auto Translation Workflow

Automatically translate an entire Joomla component by processing all view files.

## AGENTIC MODE ACTIVE

This workflow runs in **agentic mode** with expanded permissions:

**ALLOWED without asking:**
- Read/Write/Edit PHP and INI files
- Create feature branches for translation work
- Run `php -l` validation after edits
- Create workflow state files in `~/.claude/workflows/`
- Process files in chunks without confirmation

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
/translate-auto /var/www/joomla/administrator/components/com_lots fr-CA
/translate-auto ./components/com_inventory es-ES --dry-run
/translate-auto /path/to/com_mycomp de-DE --resume
```

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TRANSLATION WORKFLOW                      │
├─────────────────────────────────────────────────────────────┤
│  1. INIT        Scan component, build view queue            │
│  2. LOOP        For each view:                              │
│     ├─ PROCESS  Run /translate-view on file                 │
│     ├─ REVIEW   Validate translations (optional)            │
│     └─ NEXT     Move to next view                           │
│  3. FINALIZE    Generate summary report                     │
└─────────────────────────────────────────────────────────────┘
```

## Step 1: Initialize

### Scan Component Structure

Find all translatable view files:
```
{component}/
├── views/           # Frontend views (Joomla 3)
├── tmpl/            # Frontend templates (Joomla 4+)
├── administrator/
│   └── views/       # Admin views (Joomla 3)
│   └── tmpl/        # Admin templates (Joomla 4+)
└── src/View/        # Namespaced views (Joomla 4+)
```

File patterns to include:
- `*.php` in tmpl directories
- `*.php` view files
- Exclude: `index.html`, `metadata.xml`

### Build View Queue

Create a tracking structure:
```
Views to process:
1. [PENDING] admin/views/item/tmpl/edit.php (450 lines)
2. [PENDING] admin/views/item/tmpl/default.php (280 lines)
3. [PENDING] admin/views/items/tmpl/default.php (620 lines, CHUNKED)
...
```

### Identify INI Files

```
Source: {component}/administrator/language/en-GB/com_{name}.ini
Target: {component}/administrator/language/{lang}/com_{name}.ini

# Create target INI if doesn't exist (copy from source as template)
```

## Step 2: Process Loop

For each view in queue:

### 2a. Process View

Use the translate-view command logic:
```
Processing: admin/views/item/tmpl/edit.php
- Lines: 450 (single pass)
- Found: 23 hardcoded strings
- Converting...
```

**Large file handling:**
- Files > 300 lines: Use chunking strategy
- Process chunks sequentially
- Merge results, deduplicate overlaps
- Apply edits bottom-to-top

### 2b. Quick Validation

After each view:
```bash
php -l {view_file}
```

If syntax error:
1. Identify problematic edit
2. Roll back that specific change
3. Mark string for manual review
4. Continue with remaining strings

### 2c. Review (Optional)

If `--skip-review` not set:
- Check that all `Text::_()` calls have matching INI keys
- Verify no hardcoded strings were missed
- Validate INI file integrity

### 2d. Update Progress

```
[DONE] admin/views/item/tmpl/edit.php (23 strings)
[DOING] admin/views/items/tmpl/default.php...
[PENDING] admin/views/category/tmpl/default.php
```

## Step 3: Finalize

### Generate Summary Report

```
═══════════════════════════════════════════════════════════════
                    TRANSLATION COMPLETE
═══════════════════════════════════════════════════════════════

Component: com_lots
Target Language: fr-CA
Duration: ~15 minutes

VIEWS PROCESSED
───────────────────────────────────────────────────────────────
Total Views: 12
├─ Completed: 11
├─ Skipped (no strings): 1
└─ Failed: 0

STRINGS CONVERTED
───────────────────────────────────────────────────────────────
Total Found: 187
├─ Auto-converted: 183
├─ Manual review needed: 4
└─ Skipped (false positive): 0

BY TYPE:
  Labels:        45
  Placeholders:  23
  Headings:      18
  Buttons:       31
  Messages:      42
  JS Strings:    15
  Other:         13

INI FILE UPDATES
───────────────────────────────────────────────────────────────
en-GB.com_lots.ini: +187 keys (was 45, now 232)
fr-CA.com_lots.ini: +187 keys (was 0, now 187)

MANUAL REVIEW REQUIRED
───────────────────────────────────────────────────────────────
1. admin/views/item/tmpl/edit.php:145
   Complex concatenation: "Total: " . $count . " items"

2. admin/views/report/tmpl/default.php:89
   Dynamic string in JavaScript

NEXT STEPS
───────────────────────────────────────────────────────────────
1. Review the 4 strings marked for manual attention
2. Test the component in both languages
3. Run: php artisan lang:check (if using Laravel Mix)

═══════════════════════════════════════════════════════════════
```

## Progress Tracking

The workflow maintains state in:
```
~/.claude/workflows/active/translate-{component}-{timestamp}/
├── workflow.json      # Overall state
├── view-queue.json    # View processing status
└── strings.json       # All extracted strings with status
```

This allows:
- Resuming interrupted workflows
- Tracking what was changed where
- Rolling back if needed

## Error Recovery

| Error | Action |
|-------|--------|
| PHP syntax error | Roll back last edit, mark for manual |
| INI parse error | Escape special characters, retry |
| File not found | Skip, warn user |
| Permission denied | Stop, report issue |
| Interrupted | Save state, allow `--resume` |

## Language-Specific Rules

### French Canadian (fr-CA)
- Formal "vous"
- Space before : ; ? !
- «guillemets français»
- courriel, téléverser, etc.

### Spanish (es-ES)
- ¿ and ¡ for questions/exclamations
- Formal "usted" for admin interfaces

### German (de-DE)
- Capitalize all nouns
- Compound words
- Formal "Sie"

## Notes

- Large components may take several minutes
- Always test in a development environment first
- Backup your component before running on production code
- Use `--dry-run` first to see what would be changed
