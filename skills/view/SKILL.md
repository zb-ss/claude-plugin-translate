---
description: Process a single Joomla view file for i18n translation with smart chunking for large files
---

# Translate View File

Process a single Joomla view file to extract hardcoded strings and convert them to translatable language keys.

## AGENTIC MODE ACTIVE

**ALLOWED without asking:**
- Read/Edit the target view file
- Update source and target INI files
- Run `php -l` validation
- Use chunked processing for large files

**BLOCKED:** `git commit`, `git push`

---

## Arguments

$ARGUMENTS

- `<path>` - Path to the view file to process
- `--lang <code>` - Target language (default: fr-CA)
- `--chunk-size <n>` - Lines per chunk for large files (default: 200)

## Examples

```
/translate-view /path/to/views/item/tmpl/edit.php
/translate-view /path/to/views/item/tmpl/default.php --lang es-ES
/translate-view /path/to/large-view.php --chunk-size 150
```

## Processing Strategy

### Step 1: Analyze File Size

```bash
wc -l <view_file>
```

**Chunking thresholds:**
- < 300 lines: Process entire file at once
- 300-800 lines: Split into 2-4 chunks with 20-line overlap
- > 800 lines: Split into chunks of ~200 lines with 30-line overlap

### Step 2: Detect Hardcoded Strings

**For small files:** Read entire file and identify all hardcoded strings.

**For large files (chunked approach):**

```
1. Calculate chunks: ceil(total_lines / chunk_size)
2. For each chunk:
   a. Read lines [start - overlap, end + overlap]
   b. Find hardcoded strings in chunk
   c. Track line numbers (absolute, not relative)
   d. Store results with chunk ID
3. Merge results, deduplicate strings found in overlap regions
```

### String Types to Find

Search for these patterns in priority order:

| Priority | Type | Pattern Examples |
|----------|------|------------------|
| 1 | Labels | `<label>Text</label>`, `label="Text"` |
| 2 | Placeholders | `placeholder="Text"` |
| 3 | Headings | `<h1>Text</h1>`, `<legend>Text</legend>` |
| 4 | Tooltips | `title="Text"`, `data-tip="Text"` |
| 5 | Buttons | `<button>Text</button>`, `value="Submit"` |
| 6 | Options | `<option>Text</option>` |
| 7 | Table Headers | `<th>Text</th>` |
| 8 | Messages | `<p>Text</p>`, `<span>Text</span>` |
| 9 | JS Strings | `alert('Text')`, `confirm("Text")` |
| 10 | Vue Text | `{{ "Text" }}`, `:label="'Text'"` |

### Step 3: Generate Language Keys

Key naming convention for Joomla:
```
COM_{COMPONENT}_{TYPE}_{DESCRIPTOR}

Examples:
COM_MYCOMP_FIELD_NAME_LABEL
COM_MYCOMP_BTN_SAVE
COM_MYCOMP_MSG_SAVED_SUCCESS
COM_MYCOMP_HEADING_EDIT_ITEM
```

### Step 4: Replace Strings in View

**For PHP files:**
```php
// Before
<label>Customer Name</label>

// After
<label><?php echo Text::_('COM_MYCOMP_FIELD_CUSTOMER_NAME_LABEL'); ?></label>
```

**For JS strings:**
```php
// Before
alert('Are you sure?');

// After
alert(Joomla.Text._('COM_MYCOMP_MSG_CONFIRM_ACTION'));
```

**Chunked replacement strategy:**
1. Process replacements from BOTTOM to TOP of file (preserves line numbers)
2. Within each chunk, sort by line number descending
3. Apply edits using the Edit tool with precise line targeting

### Step 5: Update INI Files

**Source language (en-GB):**
```
{component}/administrator/language/en-GB/com_{name}.ini
```

**Target language:**
```
{component}/administrator/language/{lang}/com_{name}.ini
```

Add new keys alphabetically sorted within sections.

### Step 6: Translate to Target Language

For fr-CA specifically:
- Use "courriel" not "email"
- Use "téléverser" not "uploader"
- Space before punctuation: `Enregistré !` not `Enregistré!`
- Use « guillemets français »
- Formal "vous" form

### Step 7: Validate

```bash
php -l <view_file>  # Check PHP syntax
```

Verify INI files are valid (no duplicate keys, proper escaping).

## Output Report

```
## Translation Complete

File: {path}
Lines: {count} ({chunked: yes/no, chunks: N})

### Detection Results
| Type | Found | Converted | Skipped |
|------|-------|-----------|--------|
| Labels | 5 | 5 | 0 |
| Placeholders | 3 | 3 | 0 |
| ... | ... | ... | ... |
| **Total** | **N** | **N** | **N** |

### INI Updates
- en-GB: +{N} keys
- {target}: +{N} keys

### Validation
- PHP Syntax: PASS
- INI Valid: PASS

### Manual Review Needed
{List any strings that couldn't be auto-converted}
```

## Error Handling

- If PHP syntax fails after edits: Roll back that chunk, report the problematic string
- If string detection is ambiguous: Mark for manual review, don't auto-convert
- If INI has duplicates: Merge values, warn user

## Notes

- Always backup files before bulk operations on large views
- Process one view completely before moving to next
- Report all skipped strings with reasons
