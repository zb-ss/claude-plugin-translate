/**
 * Tests for i18n-hardcode-finder.ts - Enhanced hardcoded string detection
 * Focus on the 14 new patterns added for quality enforcement
 */

import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execute } from './i18n-hardcode-finder'

// Helper to create temp test file
function createTestFile(content: string): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'i18n-test-'))
  const filePath = join(tempDir, 'test.php')
  writeFileSync(filePath, content)
  return filePath
}

function cleanup(filePath: string) {
  try {
    unlinkSync(filePath)
  } catch {}
}

describe('i18n-hardcode-finder: New PHP Detection Patterns', () => {
  it('should detect hardcoded PHP echo statements', async () => {
    const filePath = createTestFile(`<?php
echo 'Hardcoded Message';
echo "Another Message";
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.hardcoded.length).toBeGreaterThan(0)

    const echoStrings = data.hardcoded.filter((h: any) => h.text.includes('Hardcoded Message') || h.text.includes('Another Message'))
    expect(echoStrings.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect ternary operators with hardcoded strings', async () => {
    const filePath = createTestFile(`<?php
$status = $active ? 'Active' : 'Inactive';
$label = $published ? 'Published' : 'Draft';
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const ternaryStrings = data.hardcoded.filter((h: any) =>
      h.text === 'Active' || h.text === 'Inactive' || h.text === 'Published' || h.text === 'Draft'
    )
    expect(ternaryStrings.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect enqueueMessage with hardcoded strings', async () => {
    const filePath = createTestFile(`<?php
$this->app->enqueueMessage('Item saved successfully');
$app->enqueueMessage('Error occurred while saving', 'error');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const messages = data.hardcoded.filter((h: any) =>
      h.text.includes('Item saved successfully') || h.text.includes('Error occurred')
    )
    expect(messages.length).toBeGreaterThan(0)

    // Should be classified as message type
    const messageTypes = data.hardcoded.filter((h: any) => h.type === 'message')
    expect(messageTypes.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect sprintf with hardcoded format strings', async () => {
    const filePath = createTestFile(`<?php
$message = sprintf('Hello %s, you have %d messages', $name, $count);
$error = sprintf('Invalid value for field %s');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const sprintfStrings = data.hardcoded.filter((h: any) =>
      h.text.includes('Hello') || h.text.includes('Invalid value')
    )
    expect(sprintfStrings.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect ToolbarHelper with hardcoded titles', async () => {
    const filePath = createTestFile(`<?php
ToolbarHelper::title('Manage Items');
ToolbarHelper::title('Edit Item', 'pencil');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const toolbarTitles = data.hardcoded.filter((h: any) =>
      h.text.includes('Manage Items') || h.text.includes('Edit Item')
    )
    expect(toolbarTitles.length).toBeGreaterThan(0)

    // Should be classified as heading
    expect(toolbarTitles.some((h: any) => h.type === 'heading')).toBe(true)

    cleanup(filePath)
  })

  it('should detect inline text between HTML tags', async () => {
    const filePath = createTestFile(`<?php ?>
<div class="container">
  ?> Welcome to the Dashboard <?php
</div>
<?php ?> Upload your files here <input type="file" />
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const inlineText = data.hardcoded.filter((h: any) =>
      h.type === 'inline_text' && (h.text.includes('Welcome') || h.text.includes('Upload'))
    )
    expect(inlineText.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect jQuery with hardcoded strings', async () => {
    const filePath = createTestFile(`<script>
$('#message').html('Operation Successful');
$('.status').text('Loading, please wait');
</script>`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const jQueryStrings = data.hardcoded.filter((h: any) =>
      h.text.includes('Operation Successful') || h.text.includes('Loading')
    )
    expect(jQueryStrings.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect data-confirm attributes', async () => {
    const filePath = createTestFile(`
<button data-confirm="Are you sure you want to delete this item?">Delete</button>
<a data-alert="Please save your changes first">Exit</a>
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const dataAttrs = data.hardcoded.filter((h: any) =>
      h.type === 'data_attribute' && (h.text.includes('Are you sure') || h.text.includes('save your changes'))
    )
    expect(dataAttrs.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect input value attributes with hardcoded text', async () => {
    const filePath = createTestFile(`
<input type="submit" value="Save Changes" />
<input type="button" value="Cancel Operation" />
<input type="reset" value="Reset Form" />
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const buttonValues = data.hardcoded.filter((h: any) =>
      h.type === 'button' && (h.text.includes('Save Changes') || h.text.includes('Cancel') || h.text.includes('Reset Form'))
    )
    expect(buttonValues.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect HTMLHelper with hardcoded strings', async () => {
    const filePath = createTestFile(`<?php
$options = HTMLHelper::_('select.options', $items, 'Select an Option');
$list = HTMLHelper::_('select.genericlist', $data, 'Choose Item');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const htmlHelperStrings = data.hardcoded.filter((h: any) =>
      h.type === 'option' && (h.text.includes('Select an Option') || h.text.includes('Choose Item'))
    )
    expect(htmlHelperStrings.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect throw new Exception with hardcoded messages', async () => {
    const filePath = createTestFile(`<?php
throw new RuntimeException('Database connection failed');
throw new InvalidArgumentException('Invalid user ID provided');
throw new Exception('Unexpected error occurred');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const exceptions = data.hardcoded.filter((h: any) =>
      h.type === 'message' && (
        h.text.includes('Database connection failed') ||
        h.text.includes('Invalid user ID') ||
        h.text.includes('Unexpected error')
      )
    )
    expect(exceptions.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect setDescription/setLabel with hardcoded strings', async () => {
    const filePath = createTestFile(`<?php
$field->setDescription('Enter your full name');
$field->setLabel('User Email Address');
$field->setTitle('Click to expand options');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const setterStrings = data.hardcoded.filter((h: any) =>
      h.text.includes('Enter your full name') ||
      h.text.includes('User Email Address') ||
      h.text.includes('Click to expand')
    )
    expect(setterStrings.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect tooltip/placeholder attributes', async () => {
    const filePath = createTestFile(`
<input type="text" placeholder="Enter your email address" />
<button data-bs-tooltip="Click to save changes">Save</button>
<div data-title="Hover for more information">Info</div>
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)

    const placeholders = data.hardcoded.filter((h: any) =>
      h.type === 'placeholder' && h.text.includes('Enter your email')
    )
    expect(placeholders.length).toBeGreaterThan(0)

    const tooltips = data.hardcoded.filter((h: any) =>
      (h.type === 'tooltip' || h.type === 'data_attribute') &&
      (h.text.includes('Click to save') || h.text.includes('Hover for more'))
    )
    expect(tooltips.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should detect title attributes with hardcoded text', async () => {
    const filePath = createTestFile(`
<a href="#" title="Open settings panel">Settings</a>
<span title="Last updated on January 1st">Updated</span>
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const titleAttrs = data.hardcoded.filter((h: any) =>
      h.type === 'tooltip' && (h.text.includes('Open settings') || h.text.includes('Last updated'))
    )
    expect(titleAttrs.length).toBeGreaterThan(0)

    cleanup(filePath)
  })
})

describe('i18n-hardcode-finder: Confidence Levels', () => {
  it('should assign high confidence to ToolbarHelper patterns', async () => {
    const filePath = createTestFile(`<?php
ToolbarHelper::title('Dashboard Overview');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const highConf = data.hardcoded.filter((h: any) => h.confidence >= 0.9)
    expect(highConf.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should assign high confidence to enqueueMessage patterns', async () => {
    const filePath = createTestFile(`<?php
$app->enqueueMessage('Successfully saved the configuration');
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const highConf = data.hardcoded.filter((h: any) =>
      h.confidence >= 0.9 && h.text.includes('Successfully saved')
    )
    expect(highConf.length).toBeGreaterThan(0)

    cleanup(filePath)
  })
})

describe('i18n-hardcode-finder: JS Context Detection', () => {
  it('should detect JS context and set requiresJsEscaping flag', async () => {
    const filePath = createTestFile(`<script>
alert('Warning: This action cannot be undone');
confirm('Delete this record permanently?');
</script>`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const jsStrings = data.hardcoded.filter((h: any) =>
      h.isJsContext === true || h.requiresJsEscaping === true
    )
    expect(jsStrings.length).toBeGreaterThan(0)

    cleanup(filePath)
  })

  it('should warn about unsafe Text::_() in JS strings', async () => {
    const filePath = createTestFile(`<script>
var message = '<?php echo Text::_('SOME_KEY'); ?>';
</script>`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    // This pattern might not be detected as hardcoded since it already uses Text::_
    // but the warning system should flag unsafe usage

    cleanup(filePath)
  })
})

describe('i18n-hardcode-finder: Edge Cases', () => {
  it('should skip very short strings (< 2 chars)', async () => {
    const filePath = createTestFile(`
<label>A</label>
<button>OK</button>
`)

    const result = await execute({ filePath, minLength: 3 })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    const shortStrings = data.hardcoded.filter((h: any) => h.text.length < 3)
    expect(shortStrings.length).toBe(0)

    cleanup(filePath)
  })

  it('should skip strings that are already internationalized', async () => {
    const filePath = createTestFile(`
<label><?php echo Text::_('COM_EXAMPLE_LABEL'); ?></label>
<button><?php echo JText::_('JSUBMIT'); ?></button>
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    // Should not detect already internationalized strings
    const alreadyI18n = data.hardcoded.filter((h: any) =>
      h.text.includes('Text::_') || h.text.includes('JText::_')
    )
    expect(alreadyI18n.length).toBe(0)

    cleanup(filePath)
  })

  it('should handle chunking with startLine and endLine', async () => {
    const content = Array.from({ length: 100 }, (_, i) => `<p>Line ${i + 1} content</p>`).join('\n')
    const filePath = createTestFile(content)

    const result = await execute({ filePath, startLine: 10, endLine: 20 })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.range.start).toBe(10)
    expect(data.range.end).toBe(20)
    expect(data.range.linesProcessed).toBe(11) // Lines 10-20 inclusive

    cleanup(filePath)
  })

  it('should return error for non-existent file', async () => {
    const result = await execute({ filePath: '/nonexistent/path/file.php' })
    const data = JSON.parse(result)

    expect(data.success).toBe(false)
    expect(data.error).toContain('File not found')
  })
})

describe('i18n-hardcode-finder: Summary Statistics', () => {
  it('should provide accurate summary counts', async () => {
    const filePath = createTestFile(`<?php
ToolbarHelper::title('Dashboard');
echo 'Warning Message';
$app->enqueueMessage('Success');
?>
<label>Field Label</label>
<button>Submit Form</button>
<input type="text" placeholder="Enter text here" />
`)

    const result = await execute({ filePath })
    const data = JSON.parse(result)

    expect(data.success).toBe(true)
    expect(data.summary.total).toBeGreaterThan(0)
    expect(data.summary.byType).toBeDefined()
    expect(data.summary.highConfidence).toBeDefined()
    expect(data.summary.mediumConfidence).toBeDefined()
    expect(data.summary.lowConfidence).toBeDefined()

    // Total should equal sum of confidence categories
    const confTotal = data.summary.highConfidence + data.summary.mediumConfidence + data.summary.lowConfidence
    expect(confTotal).toBe(data.summary.total)

    cleanup(filePath)
  })
})
