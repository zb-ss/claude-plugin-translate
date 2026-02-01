/**
 * i18n Extract Tool
 *
 * Extract i18n strings from code files. Finds already-translated strings
 * (using Text::_() etc) and identifies the translation patterns used.
 */

import { readFileSync, existsSync } from "fs"
import { z } from "zod"

interface ExtractedString {
  key: string | null
  value: string
  line: number
  type: "translated" | "hardcoded"
  pattern: string
  context: string
  hasPlaceholders: boolean
  placeholders: string[]
}

// Patterns for different frameworks
const patterns = {
  joomla: {
    translated: [
      // PHP patterns - Joomla 4+
      { regex: /Text::_\(\s*['"]([^'"]+)['"]\s*\)/g, name: "Text::_" },
      { regex: /Text::sprintf\(\s*['"]([^'"]+)['"]/g, name: "Text::sprintf" },
      { regex: /Text::plural\(\s*['"]([^'"]+)['"]/g, name: "Text::plural" },
      // Legacy Joomla 3
      { regex: /JText::_\(\s*['"]([^'"]+)['"]\s*\)/g, name: "JText::_" },
      { regex: /JText::sprintf\(\s*['"]([^'"]+)['"]/g, name: "JText::sprintf" },
      // JavaScript patterns
      { regex: /Joomla\.JText\._\(\s*['"]([^'"]+)['"]\s*\)/g, name: "Joomla.JText._" },
      { regex: /Joomla\.Text\._\(\s*['"]([^'"]+)['"]\s*\)/g, name: "Joomla.Text._" }
    ]
  },
  laravel: {
    translated: [
      { regex: /__\(\s*['"]([^'"]+)['"]/g, name: "__" },
      { regex: /trans\(\s*['"]([^'"]+)['"]/g, name: "trans" },
      { regex: /@lang\(\s*['"]([^'"]+)['"]/g, name: "@lang" }
    ]
  },
  symfony: {
    translated: [
      { regex: /->trans\(\s*['"]([^'"]+)['"]/g, name: "trans" },
      { regex: /\|trans/g, name: "|trans" }
    ]
  },
  vue: {
    translated: [
      { regex: /\$t\(\s*['"]([^'"]+)['"]\s*\)/g, name: "$t" },
      { regex: /\{\{\s*\$t\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, name: "{{ $t }}" },
      { regex: /v-t="'([^']+)'"/g, name: "v-t" }
    ]
  }
}

// Placeholder patterns
const placeholderPatterns = [
  /%s/g,
  /%d/g,
  /%f/g,
  /%\d+\$s/g,
  /%\d+\$d/g,
  /%%/g,
  /\{[^}]+\}/g
]

function extractPlaceholders(value: string): string[] {
  const found: string[] = []
  for (const pattern of placeholderPatterns) {
    const matches = value.match(pattern)
    if (matches) {
      found.push(...matches)
    }
  }
  return [...new Set(found)]
}

function findContext(lines: string[], lineNumber: number): string {
  const searchStart = Math.max(0, lineNumber - 50)

  for (let i = lineNumber - 1; i >= searchStart; i--) {
    const line = lines[i]

    const phpFunc = line.match(/function\s+(\w+)\s*\(/i)
    if (phpFunc) return `${phpFunc[1]}()`

    const phpMethod = line.match(/(?:public|private|protected)\s+function\s+(\w+)/i)
    if (phpMethod) return `${phpMethod[1]}()`

    const jsFunc = line.match(/(?:function\s+)?(\w+)\s*[:=]\s*function\s*\(/i)
    if (jsFunc) return `${jsFunc[1]}()`

    const vueMethod = line.match(/^\s*(\w+)\s*\(\s*\)\s*\{/i)
    if (vueMethod) return `${vueMethod[1]}()`

    const arrowFunc = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/i)
    if (arrowFunc) return `${arrowFunc[1]}()`
  }

  return "unknown"
}

export const i18nExtractSchema = z.object({
  filePath: z.string().describe("Path to the file to extract strings from"),
  startLine: z.number().optional().describe("Start line for chunk processing (1-based)"),
  endLine: z.number().optional().describe("End line for chunk processing"),
  framework: z.enum(["joomla", "laravel", "symfony", "vue"]).default("joomla").describe("Framework to use for pattern matching")
})

export type I18nExtractArgs = z.infer<typeof i18nExtractSchema>

export async function execute(args: I18nExtractArgs): Promise<string> {
  const { filePath, startLine, endLine, framework = "joomla" } = args

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

  const extracted: ExtractedString[] = []
  const frameworkPatterns = patterns[framework as keyof typeof patterns]

  if (!frameworkPatterns) {
    return JSON.stringify({
      success: false,
      error: `Unknown framework: ${framework}. Supported: joomla, laravel, symfony, vue`
    }, null, 2)
  }

  for (let i = 0; i < linesToProcess.length; i++) {
    const line = linesToProcess[i]
    const actualLineNumber = lineOffset + i + 1

    for (const pattern of frameworkPatterns.translated) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
      let match

      while ((match = regex.exec(line)) !== null) {
        const key = match[1]
        const placeholders = extractPlaceholders(key)

        const exists = extracted.find(e => e.key === key && e.line === actualLineNumber)
        if (!exists) {
          extracted.push({
            key,
            value: key,
            line: actualLineNumber,
            type: "translated",
            pattern: pattern.name,
            context: findContext(allLines, actualLineNumber),
            hasPlaceholders: placeholders.length > 0,
            placeholders
          })
        }
      }
    }
  }

  extracted.sort((a, b) => a.line - b.line)

  const translated = extracted.filter(e => e.type === "translated")
  const withPlaceholders = extracted.filter(e => e.hasPlaceholders)

  const uniqueKeys = [...new Set(extracted.map(e => e.key).filter(Boolean))]

  return JSON.stringify({
    success: true,
    filePath,
    framework,
    range: {
      start: startLine ?? 1,
      end: endLine ?? allLines.length,
      linesProcessed: linesToProcess.length
    },
    strings: extracted,
    summary: {
      total: extracted.length,
      translated: translated.length,
      hardcoded: 0,
      withPlaceholders: withPlaceholders.length,
      uniqueKeys: uniqueKeys.length
    },
    uniqueKeys
  }, null, 2)
}

export const i18nExtractTool = {
  name: "i18n_extract",
  description: "Extract i18n strings from code files. Finds both already-translated strings (using Text::_() etc) and identifies the translation patterns used.",
  inputSchema: {
    type: "object" as const,
    properties: {
      filePath: { type: "string", description: "Path to the file to extract strings from" },
      startLine: { type: "number", description: "Start line for chunk processing (1-based)" },
      endLine: { type: "number", description: "End line for chunk processing" },
      framework: {
        type: "string",
        enum: ["joomla", "laravel", "symfony", "vue"],
        description: "Framework to use for pattern matching",
        default: "joomla"
      }
    },
    required: ["filePath"]
  },
  execute
}
