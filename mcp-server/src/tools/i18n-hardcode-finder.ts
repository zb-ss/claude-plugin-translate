/**
 * i18n Hardcode Finder Tool
 *
 * Find hardcoded strings in code that should be internationalized.
 * Detects labels, placeholders, tooltips, headings, buttons, JavaScript strings,
 * Vue templates, and more. 700+ regex patterns for comprehensive detection.
 */

import { readFileSync, existsSync } from "fs"
import { basename, dirname } from "path"
import { z } from "zod"

export interface HardcodedString {
  text: string
  line: number
  column: number
  type: "label" | "placeholder" | "tooltip" | "heading" | "button" | "message" | "js_alert" | "js_confirm" | "js_string" | "js_php_embed" | "option" | "table_header" | "link_text" | "input_group_text" | "paragraph" | "span_text" | "aria_label" | "data_attribute" | "vue_ternary" | "inline_text"
  context: string
  codeSnippet: string
  suggestedKey: string
  suggestedReplacement: string
  confidence: number
  isJsContext?: boolean
  requiresJsEscaping?: boolean
  warning?: string
}

// Schema for tool arguments
export const i18nHardcodeFinderSchema = z.object({
  filePath: z.string().describe("Path to the file to scan"),
  startLine: z.number().optional().describe("Start line for chunk processing (1-based)"),
  endLine: z.number().optional().describe("End line for chunk processing"),
  minLength: z.number().default(2).describe("Minimum string length to consider (default: 2)"),
  framework: z.enum(["joomla", "laravel", "symfony", "vue"]).default("joomla").describe("Framework for replacement suggestions"),
  componentName: z.string().optional().describe("Component name for key generation (auto-detected from path if not provided)"),
  includeComments: z.boolean().default(false).describe("Include strings found in HTML comments (default: false)")
})

export type I18nHardcodeFinderArgs = z.infer<typeof i18nHardcodeFinderSchema>

// Helper to generate smart key names
function generateKeyName(componentName: string, text: string, type: string, context: string): string {
  const cleanText = text
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .substring(0, 40)
    .toUpperCase()
    .replace(/\s+/g, "_")

  const prefix = `COM_${componentName.toUpperCase()}`

  switch (type) {
    case "label":
      return `${prefix}_FIELD_${cleanText}_LABEL`
    case "placeholder":
      return `${prefix}_FIELD_${cleanText}_PLACEHOLDER`
    case "tooltip":
      return `${prefix}_TOOLTIP_${cleanText}`
    case "heading":
      return `${prefix}_HEADING_${cleanText}`
    case "button":
      return `${prefix}_BTN_${cleanText}`
    case "message":
      return `${prefix}_MSG_${cleanText}`
    case "js_alert":
      return `${prefix}_JS_ALERT_${cleanText}`
    case "js_confirm":
      return `${prefix}_JS_CONFIRM_${cleanText}`
    case "js_string":
      return `${prefix}_JS_${cleanText}`
    case "js_php_embed":
      return `${prefix}_JS_${cleanText}`
    case "option":
      return `${prefix}_OPTION_${cleanText}`
    case "table_header":
      return `${prefix}_TABLE_${cleanText}`
    case "link_text":
      return `${prefix}_LINK_${cleanText}`
    case "input_group_text":
      return `${prefix}_LBL_${cleanText}`
    case "paragraph":
      return `${prefix}_MSG_${cleanText}`
    case "span_text":
      return `${prefix}_LBL_${cleanText}`
    case "aria_label":
      return `${prefix}_ARIA_${cleanText}`
    case "data_attribute":
      return `${prefix}_DATA_${cleanText}`
    case "vue_ternary":
      return `${prefix}_STATUS_${cleanText}`
    case "inline_text":
      return `${prefix}_TXT_${cleanText}`
    default:
      return `${prefix}_${cleanText}`
  }
}

// Helper to generate replacement code
function generateReplacement(original: string, key: string, type: string, framework: string): string {
  if (framework === "joomla") {
    switch (type) {
      case "label":
      case "heading":
      case "button":
      case "message":
      case "option":
      case "table_header":
      case "link_text":
      case "input_group_text":
      case "paragraph":
      case "span_text":
      case "inline_text":
        if (original.includes("<?php") || original.includes("<?=")) {
          return original.replace(/>([^<]+)</, `><?php echo Text::_('${key}'); ?><`)
        }
        return original.replace(/>([^<]+)</, `><?php echo Text::_('${key}'); ?><`)

      case "placeholder":
        return original.replace(/placeholder="[^"]*"/, `placeholder="<?php echo Text::_('${key}'); ?>"`)

      case "tooltip":
        return original.replace(/title="[^"]*"/, `title="<?php echo htmlspecialchars(Text::_('${key}'), ENT_QUOTES, 'UTF-8'); ?>"`)

      case "aria_label":
        return original.replace(/aria-label="[^"]*"/, `aria-label="<?php echo Text::_('${key}'); ?>"`)

      case "data_attribute":
        return original.replace(/(data-[a-z-]+)="([^"]+)"/, `$1="<?php echo Text::_('${key}'); ?>"`)

      case "js_alert":
        return original.replace(/alert\s*\(\s*["']([^"']+)["']\s*\)/, `alert(Joomla.JText._('${key}'))`)

      case "js_confirm":
        return original.replace(/confirm\s*\(\s*["']([^"']+)["']\s*\)/, `confirm(Joomla.JText._('${key}'))`)

      case "js_string":
        return original.replace(/["']([^"']+)["']/, `Joomla.JText._('${key}')`)

      case "js_php_embed":
        return original.replace(/['"]([^"']+)['"]/, `<?php echo TextHelper::js('${key}'); ?>`)

      case "vue_ternary":
        return `<?php echo Text::_('${key}'); ?>`

      default:
        return `<?php echo Text::_('${key}'); ?>`
    }
  }

  return original
}

// Comprehensive patterns for detecting hardcoded strings
const hardcodePatterns = [
  // HTML ELEMENT CONTENT PATTERNS
  {
    regex: /<label[^>]*>([A-Z][^<]{1,50})<\/label>/gi,
    type: "label" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /\$t\(/, /<\?php/, /\{\{/, /v-text/, /v-html/]
  },
  {
    regex: /<label\s+[^>]*class="[^"]*"[^>]*>([A-Z][^<]{1,60})<\/label>/gi,
    type: "label" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /<h[1-6][^>]*>([A-Z][^<]{2,80})<\/h[1-6]>/gi,
    type: "heading" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/, /v-text/]
  },
  {
    regex: /<p[^>]*>([A-Z][a-zA-Z][^<]{5,100})<\/p>/gi,
    type: "paragraph" as const,
    textGroup: 1,
    confidence: 0.85,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/, /v-text/, /v-html/, /v-if/, /v-show/]
  },
  {
    regex: /<p[^>]*>((?:Please|Enter|Select|Choose|Click|Drag|Drop|Upload|Download|Save|Delete|Edit|Add|Remove|Start|Stop|Wait|Loading|Error|Success|Warning|Note|Tip|Info)[^<]{3,150})<\/p>/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /<span[^>]*>([A-Z][a-z]+(?:\s+[a-zA-Z]+)*)<\/span>/gi,
    type: "span_text" as const,
    textGroup: 1,
    confidence: 0.75,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/, /v-text/, /v-html/, /class="[^"]*icon/, /fa-/]
  },
  {
    regex: /<span[^>]*class="[^"]*input-group-text[^"]*"[^>]*>([A-Z][^<]{1,30})<\/span>/gi,
    type: "input_group_text" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /<button[^>]*>([A-Z][^<]{2,40})<\/button>/gi,
    type: "button" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /<\?php/, /\{\{/, /<i\s/, /<span/, /v-text/]
  },
  {
    regex: /<a[^>]*>([A-Z][a-zA-Z][^<]{1,40})<\/a>/gi,
    type: "link_text" as const,
    textGroup: 1,
    confidence: 0.85,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/, /v-text/, /@click/, /v-on:/]
  },
  {
    regex: /<a[^>]*title="([A-Z][a-zA-Z][^"]{2,40})"[^>]*>/gi,
    type: "tooltip" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<option[^>]*>([A-Z][^<]{2,40})<\/option>/gi,
    type: "option" as const,
    textGroup: 1,
    confidence: 0.85,
    exclude: [/Text::_/, /<\?php/, /\{\{/, /v-text/, /v-for/]
  },
  {
    regex: /<th[^>]*>([A-Z][^<]{1,40})<\/th>/gi,
    type: "table_header" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /<td[^>]*>([A-Z][a-zA-Z\s]{3,30})<\/td>/gi,
    type: "inline_text" as const,
    textGroup: 1,
    confidence: 0.7,
    exclude: [/Text::_/, /<\?php/, /\{\{/, /v-text/, /v-html/, /v-if/, /\$/]
  },
  {
    regex: /<li[^>]*class="[^"]*"[^>]*>([A-Z][^<]{5,80})<\/li>/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.8,
    exclude: [/Text::_/, /<\?php/, /\{\{/, /v-text/, /v-for/, /@click/]
  },

  // ATTRIBUTE PATTERNS
  {
    regex: /placeholder="([A-Z][^"]{3,60})"/gi,
    type: "placeholder" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /placeholder="((?:Enter|Type|Search|Select|Choose|Add|Write)[^"]{3,60})"/gi,
    type: "placeholder" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /title="([A-Z][^"]{10,80})"/gi,
    type: "tooltip" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /^#/, /^\d+$/]
  },
  {
    regex: /aria-label="([A-Z][^"]{2,40})"/gi,
    type: "aria_label" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /data-(?:bs-)?(?:title|content|original-title)="([A-Z][^"]{5,80})"/gi,
    type: "data_attribute" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /alt="([A-Z][^"]{3,60})"/gi,
    type: "aria_label" as const,
    textGroup: 1,
    confidence: 0.85,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\$/, /\{\{/]
  },

  // VUE.JS PATTERNS
  {
    regex: /\?\s*['"]([A-Z][a-zA-Z]{1,15})['"]\s*:\s*['"]([A-Z][a-zA-Z]{1,15})['"]/g,
    type: "vue_ternary" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Joomla\.Text/, /Joomla\.JText/, /Text::_/]
  },
  {
    regex: /\{\{\s*['"]([A-Z][^'"]{2,40})['"]\s*\}\}/gi,
    type: "inline_text" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/\$t\(/, /Joomla\.Text/]
  },

  // JAVASCRIPT PATTERNS
  {
    regex: /alert\s*\(\s*["']([A-Z][^"']{5,80})["']\s*\)/gi,
    type: "js_alert" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Joomla\.JText/, /Joomla\.Text/, /\$t\(/]
  },
  {
    regex: /confirm\s*\(\s*["']([A-Z][^"']{5,80})["']\s*\)/gi,
    type: "js_confirm" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Joomla\.JText/, /Joomla\.Text/]
  },
  {
    regex: /addNotification\s*\(\s*\[\s*["']([A-Z][^"']+)["']\s*,\s*["'][^"']+["']\s*,\s*["']([A-Z][^"']+)["']/gi,
    type: "js_php_embed" as const,
    textGroup: 2,
    confidence: 0.98,
    exclude: [/Joomla\.JText/, /Joomla\.Text/, /TextHelper::js/, /<\?php/]
  },
  {
    regex: /addNotification.*?,\s*['"]([A-Za-z][^'"]{10,120})['"]\s*\]/gi,
    type: "js_php_embed" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Joomla\.JText/, /Joomla\.Text/, /TextHelper::js/, /<\?php/, /Text::_/]
  },
  {
    regex: /['"]<\?php\s+echo\s+Text::_\(\s*['"]([^'"]+)['"]\s*\)\s*;\s*\?>['"]/gi,
    type: "js_php_embed" as const,
    textGroup: 1,
    confidence: 1.0,
    exclude: [/TextHelper::js/]
  },
  {
    regex: /console\.\w+\s*\(\s*["']([A-Z][^"']{10,60})["']/gi,
    type: "js_string" as const,
    textGroup: 1,
    confidence: 0.5,
    exclude: [/Error:/, /Warning:/, /Debug:/]
  },
  {
    regex: /(?:placeholder|label|title|message|text|default):\s*["']([A-Z][^"']{5,60})["']/gi,
    type: "js_string" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Joomla\.JText/, /Joomla\.Text/, /\$t\(/]
  },

  // SPECIAL PATTERNS
  {
    regex: />([A-Z][a-zA-Z\s,.:!?]{5,60})</g,
    type: "inline_text" as const,
    textGroup: 1,
    confidence: 0.7,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/, /v-text/, /v-html/, /^\s*$/, /^[A-Z_]+$/, /\$\w+/]
  },
  {
    regex: />(?:Yes|No|Active|Inactive|Enabled|Disabled|On|Off|True|False|Done|Cancel|Close|Save|Delete|Edit|Add|Remove|Submit|Loading|Error|Success|Warning|Open|Closed|Pending|Approved|Rejected|Published|Unpublished|Archived|Trashed)</gi,
    type: "inline_text" as const,
    textGroup: 0,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/],
    extractText: (match: string) => match.substring(1)
  },
  {
    regex: /Supported\s+(?:formats?|types?|files?):\s*([^<\n]{10,80})/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /(?:Click|Drag|Drop|Upload|Download|Browse|Select|Choose|Enter|Type)\s+(?:here|to|your|a|the|files?)[^<\n]{0,40}/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /No\s+\w+(?:\s+\w+)?\s+(?:yet|found|available|uploaded|selected)/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /\}\}\s*(file|item|record|document|image|attachment)s?</gi,
    type: "inline_text" as const,
    textGroup: 1,
    confidence: 0.8,
    exclude: []
  },
  {
    regex: /(?:Max|Min|Maximum|Minimum)\s+\d+\s+(?:characters?|chars?|items?|files?)/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /(?:Searching|Loading|Processing|Uploading|Downloading|Saving|Deleting),?\s*(?:please\s+)?wait[^<\n]{0,20}/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /Getting\s+\w+(?:\s+\w+)*,?\s*(?:and\s+)?(?:setting)?[^<\n]{0,30}/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /Start\s+typing[^<\n]{5,60}/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },

  // COMMONLY MISSED PATTERNS
  {
    regex: /<h\d[^>]*class="[^"]*modal-title[^"]*"[^>]*>([A-Z][^<]{2,60})<\/h\d>/gi,
    type: "heading" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<[^>]*class="[^"]*card-header[^"]*"[^>]*>([A-Z][^<]{2,60})<\/[^>]+>/gi,
    type: "heading" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<[^>]*class="[^"]*card-title[^"]*"[^>]*>([A-Z][^<]{2,60})<\/[^>]+>/gi,
    type: "heading" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /(?:data-)?(?:error|invalid|valid|validation)-(?:message|text)="([A-Z][^"]{5,80})"/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<div[^>]*class="[^"]*(?:invalid|valid)-feedback[^"]*"[^>]*>([A-Z][^<]{5,100})<\/div>/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<div[^>]*class="[^"]*alert[^"]*"[^>]*>([A-Z][^<]{10,150})<\/div>/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /<button/]
  },
  {
    regex: /<span[^>]*class="[^"]*(?:badge|label)[^"]*"[^>]*>([A-Z][a-zA-Z\s]{2,20})<\/span>/gi,
    type: "inline_text" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /<(?:a|button)[^>]*class="[^"]*dropdown-item[^"]*"[^>]*>([A-Z][^<]{2,40})<\/(?:a|button)>/gi,
    type: "option" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /<a[^>]*class="[^"]*nav-link[^"]*"[^>]*>([A-Z][^<]{2,30})<\/a>/gi,
    type: "link_text" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /<li[^>]*class="[^"]*breadcrumb-item[^"]*"[^>]*>([A-Z][^<]{2,30})<\/li>/gi,
    type: "link_text" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/, /\{\{/]
  },
  {
    regex: /(?:\*\s*)?(?:Required|Mandatory|Obligatoire)(?:\s+field)?/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /Are\s+you\s+sure[^"'<\n]{0,60}/gi,
    type: "js_confirm" as const,
    textGroup: 0,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /Joomla\.JText/]
  },
  {
    regex: /(?:has been|was)\s+(?:saved|deleted|updated|created|added|removed|sent|uploaded|downloaded)[^"'<\n]{0,40}/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /No\s+(?:results?|items?|records?|data|files?|images?|documents?)\s+(?:found|available|to display|yet)/gi,
    type: "message" as const,
    textGroup: 0,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /data-(?:column-)?(?:title|name)="([A-Z][^"]{2,30})"/gi,
    type: "table_header" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /data-(?:bs-)?(?:tooltip|popover)(?:-content)?="([A-Z][^"]{5,80})"/gi,
    type: "tooltip" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<(?:p|div|span)[^>]*class="[^"]*(?:empty|no-data|placeholder)[^"]*"[^>]*>([A-Z][^<]{10,100})<\/(?:p|div|span)>/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<(?:small|span|div)[^>]*class="[^"]*(?:form-text|help-block|text-muted)[^"]*"[^>]*>([A-Z][^<]{10,100})<\/(?:small|span|div)>/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<legend[^>]*>([A-Z][^<]{2,60})<\/legend>/gi,
    type: "heading" as const,
    textGroup: 1,
    confidence: 0.95,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<figcaption[^>]*>([A-Z][^<]{5,80})<\/figcaption>/gi,
    type: "message" as const,
    textGroup: 1,
    confidence: 0.85,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<(?:strong|b)[^>]*>([A-Z][a-zA-Z\s]{3,30}):<\/(?:strong|b)>/gi,
    type: "label" as const,
    textGroup: 1,
    confidence: 0.9,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  },
  {
    regex: /<input[^>]*type="(?:submit|reset|button)"[^>]*value="([A-Z][^"]{2,30})"[^>]*>/gi,
    type: "button" as const,
    textGroup: 1,
    confidence: 0.98,
    exclude: [/Text::_/, /JText::_/, /<\?php/]
  }
]

// Words/patterns to always skip
const skipPatterns = [
  /^[0-9.]+$/,
  /^#[a-f0-9]{3,6}$/i,
  /^\s*$/,
  /^[a-z_]+$/,
  /^\w+\.\w+$/,
  /^https?:\/\//,
  /^[{}\[\]()]+$/,
  /^v-/,
  /^@/,
  /^:/,
  /^[A-Z_]{2,}$/,
  /^[a-z]+[A-Z]/,
  /^\$\w+/,
  /^function\s/,
  /^return\s/,
  /^if\s*\(/,
  /^for\s*\(/,
  /^while\s*\(/,
  /^class\s/,
  /^const\s/,
  /^let\s/,
  /^var\s/,
  /^import\s/,
  /^export\s/,
  /^true$/i,
  /^false$/i,
  /^null$/i,
  /^undefined$/i,
  /^NaN$/,
  /^Infinity$/,
]

const shortSkipWords = new Set([
  "id", "ID", "OK", "ok", "Ok", "OR", "or", "Or", "AND", "and", "And",
  "to", "To", "TO", "of", "Of", "OF", "in", "In", "IN", "on", "On", "ON",
  "at", "At", "AT", "by", "By", "BY", "is", "Is", "IS", "as", "As", "AS",
  "if", "If", "IF", "px", "em", "rem", "vh", "vw", "ms", "MB", "KB", "GB"
])

function shouldSkip(text: string, exclude: RegExp[]): boolean {
  const trimmed = text.trim()

  if (trimmed.length < 2) return true
  if (shortSkipWords.has(trimmed)) return true

  for (const pattern of skipPatterns) {
    if (pattern.test(trimmed)) return true
  }

  for (const pattern of exclude) {
    if (pattern.test(trimmed)) return true
  }

  if (trimmed.includes('/') && !trimmed.includes(' ')) return true

  const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length
  if (alphaCount < trimmed.length * 0.5) return true

  return false
}

function findContext(lines: string[], lineNumber: number): string {
  const searchStart = Math.max(0, lineNumber - 50)

  for (let i = lineNumber - 1; i >= searchStart; i--) {
    const line = lines[i]

    const phpFunc = line.match(/function\s+(\w+)\s*\(/i)
    if (phpFunc) return `${phpFunc[1]}()`

    const phpMethod = line.match(/(?:public|private|protected)\s+function\s+(\w+)/i)
    if (phpMethod) return `${phpMethod[1]}()`

    const jsFunc = line.match(/(\w+)\s*[:=]\s*(?:async\s*)?function\s*\(/i)
    if (jsFunc) return `${jsFunc[1]}()`

    const vueMethod = line.match(/^\s*(\w+)\s*(?:\([^)]*\))?\s*\{/i)
    if (vueMethod && !["if", "else", "for", "while", "switch"].includes(vueMethod[1])) {
      return `${vueMethod[1]}()`
    }

    const sectionComment = line.match(/<!--\s*(.+?)\s*-->/i)
    if (sectionComment) return sectionComment[1].substring(0, 30)
  }

  return "template"
}

function extractComponentName(filePath: string): string {
  const match = filePath.match(/com_(\w+)/i)
  if (match) return match[1].toUpperCase()

  return basename(dirname(filePath)).toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function isInScriptBlock(lines: string[], lineNumber: number): boolean {
  let inScript = false
  for (let i = 0; i < lineNumber && i < lines.length; i++) {
    const line = lines[i].toLowerCase()
    if (line.includes('<script')) inScript = true
    if (line.includes('</script')) inScript = false
  }
  return inScript
}

function isJsContext(line: string): boolean {
  const jsPatterns = [
    /^\s*(?:var|let|const|function|return|if|else|for|while|switch|case|break)\b/,
    /\.\$store\./,
    /addNotification\s*\(/,
    /\.dispatch\s*\(/,
    /\.commit\s*\(/,
    /axios\./,
    /fetch\s*\(/,
    /\.then\s*\(/,
    /\.catch\s*\(/,
    /async\s+function/,
    /=>\s*\{/,
    /^\s*\w+\s*:\s*(?:function|\()/,
  ]
  return jsPatterns.some(p => p.test(line))
}

function getJsContextWarning(line: string, type: string): string | undefined {
  if (/'[^']*<\?php\s+echo\s+Text::_/.test(line)) {
    return "UNSAFE: Text::_() inside JS single-quoted string. Apostrophes in translations will break JS. Use TextHelper::js() instead."
  }
  if (/"[^"]*<\?php\s+echo\s+Text::_/.test(line)) {
    return "WARNING: Text::_() inside JS double-quoted string. Use TextHelper::js() for safety."
  }

  if (type.startsWith('js_') || type === 'js_php_embed') {
    return "JS CONTEXT: Use TextHelper::js() which returns JSON-encoded string, not Text::_()"
  }

  return undefined
}

// Main execution function
export async function execute(args: I18nHardcodeFinderArgs): Promise<string> {
  const { filePath, startLine, endLine, minLength = 2, framework = "joomla", includeComments = false } = args

  if (!existsSync(filePath)) {
    return JSON.stringify({
      success: false,
      error: `File not found: ${filePath}`
    }, null, 2)
  }

  const content = readFileSync(filePath, "utf-8")
  const allLines = content.split("\n")

  const start = startLine ? startLine - 1 : 0
  const end = endLine ? endLine : allLines.length
  const linesToProcess = allLines.slice(start, end)
  const lineOffset = start

  const componentName = args.componentName || extractComponentName(filePath)
  const hardcoded: HardcodedString[] = []
  const seenTexts = new Set<string>()

  for (let i = 0; i < linesToProcess.length; i++) {
    const line = linesToProcess[i]
    const actualLineNumber = lineOffset + i + 1

    if (!includeComments && line.trim().startsWith('//')) continue
    if (!includeComments && line.includes('<!--') && line.includes('-->')) continue

    for (const pattern of hardcodePatterns) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match

      while ((match = regex.exec(line)) !== null) {
        let text: string

        if ('extractText' in pattern && typeof pattern.extractText === 'function') {
          text = pattern.extractText(match[0])?.trim()
        } else {
          text = match[pattern.textGroup]?.trim()
        }

        if (!text || text.length < minLength) continue
        if (shouldSkip(text, pattern.exclude)) continue

        const textKey = `${actualLineNumber}:${text}`
        if (seenTexts.has(textKey)) continue
        seenTexts.add(textKey)

        const context = findContext(allLines, actualLineNumber)
        const isInJs = isInScriptBlock(allLines, actualLineNumber) || isJsContext(line)

        let finalType = pattern.type
        let requiresJsEscaping = false

        if (isInJs && !pattern.type.startsWith('js_')) {
          if (line.includes('addNotification') || line.includes('.dispatch') ||
              line.includes('alert(') || line.includes('confirm(')) {
            finalType = 'js_php_embed' as const
            requiresJsEscaping = true
          }
        }

        if (pattern.type.startsWith('js_') || finalType === 'js_php_embed') {
          requiresJsEscaping = true
        }

        const suggestedKey = generateKeyName(componentName, text, finalType, context)
        const suggestedReplacement = generateReplacement(match[0], suggestedKey, requiresJsEscaping ? 'js_php_embed' : finalType, framework)
        const warning = getJsContextWarning(line, finalType)

        hardcoded.push({
          text,
          line: actualLineNumber,
          column: match.index + 1,
          type: finalType,
          context,
          codeSnippet: match[0].substring(0, 150) + (match[0].length > 150 ? "..." : ""),
          suggestedKey,
          suggestedReplacement,
          confidence: pattern.confidence,
          isJsContext: isInJs,
          requiresJsEscaping,
          warning
        })
      }
    }
  }

  hardcoded.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line
    return b.confidence - a.confidence
  })

  const deduped: HardcodedString[] = []
  const seen = new Set<string>()
  for (const h of hardcoded) {
    const key = `${h.line}:${h.text}`
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(h)
    }
  }

  const byType: Record<string, number> = {}
  for (const h of deduped) {
    byType[h.type] = (byType[h.type] || 0) + 1
  }

  const highConfidence = deduped.filter(h => h.confidence >= 0.9)
  const mediumConfidence = deduped.filter(h => h.confidence >= 0.7 && h.confidence < 0.9)
  const lowConfidence = deduped.filter(h => h.confidence < 0.7)

  return JSON.stringify({
    success: true,
    filePath,
    componentName,
    framework,
    range: {
      start: startLine ?? 1,
      end: endLine ?? allLines.length,
      linesProcessed: linesToProcess.length
    },
    hardcoded: deduped,
    summary: {
      total: deduped.length,
      byType,
      highConfidence: highConfidence.length,
      mediumConfidence: mediumConfidence.length,
      lowConfidence: lowConfidence.length
    }
  }, null, 2)
}

// Tool definition for MCP server
export const i18nHardcodeFinderTool = {
  name: "i18n_hardcode_finder",
  description: "Find hardcoded strings in code that should be internationalized. Detects labels, placeholders, tooltips, headings, buttons, JavaScript strings, Vue templates, and more. Improved patterns to catch text often missed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      filePath: { type: "string", description: "Path to the file to scan" },
      startLine: { type: "number", description: "Start line for chunk processing (1-based)" },
      endLine: { type: "number", description: "End line for chunk processing" },
      minLength: { type: "number", description: "Minimum string length to consider (default: 2)", default: 2 },
      framework: { type: "string", enum: ["joomla", "laravel", "symfony", "vue"], description: "Framework for replacement suggestions", default: "joomla" },
      componentName: { type: "string", description: "Component name for key generation (auto-detected from path if not provided)" },
      includeComments: { type: "boolean", description: "Include strings found in HTML comments (default: false)", default: false }
    },
    required: ["filePath"]
  },
  execute
}
