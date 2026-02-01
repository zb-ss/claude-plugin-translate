/**
 * i18n Verify Tool
 *
 * Verify all Text::_() calls have matching INI keys.
 * Finds missing translations and orphan keys.
 */

import { readFileSync, existsSync } from "fs"
import { basename, join } from "path"
import { execSync } from "child_process"
import { z } from "zod"

interface MissingKey {
  key: string
  file: string
  line: number
  context: string
}

interface OrphanKey {
  key: string
  iniFile: string
}

interface VerifyResult {
  success: boolean
  phpFiles: number
  totalCalls: number
  uniqueKeys: number
  missingInSource: MissingKey[]
  missingInTarget: MissingKey[]
  orphanKeysSource: OrphanKey[]
  orphanKeysTarget: OrphanKey[]
  summary: string
}

function parseIniFile(filePath: string): Map<string, string> {
  const keys = new Map<string, string>()
  if (!existsSync(filePath)) return keys

  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue

    const match = trimmed.match(/^([A-Z][A-Z0-9_]+)\s*=\s*"(.*)"\s*$/)
    if (match) {
      keys.set(match[1], match[2])
    }
  }

  return keys
}

function extractTextCalls(componentPath: string): Map<string, { files: string[], lines: number[] }> {
  const calls = new Map<string, { files: string[], lines: number[] }>()

  try {
    const result = execSync(
      `grep -rn "Text::_\\|JText::_\\|Joomla\\.JText\\._\\|Joomla\\.Text\\._" "${componentPath}" --include="*.php" 2>/dev/null || true`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    )

    const lines = result.split("\n").filter(l => l.trim())

    for (const line of lines) {
      const match = line.match(/^([^:]+):(\d+):(.+)$/)
      if (!match) continue

      const [, file, lineNum, content] = match

      const keyMatches = content.matchAll(/(?:Text::_|JText::_)\s*\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g)
      for (const keyMatch of keyMatches) {
        const key = keyMatch[1]
        if (!calls.has(key)) {
          calls.set(key, { files: [], lines: [] })
        }
        const entry = calls.get(key)!
        if (!entry.files.includes(file)) {
          entry.files.push(file)
          entry.lines.push(parseInt(lineNum))
        }
      }

      const jsKeyMatches = content.matchAll(/Joomla\.(?:J)?Text\._\s*\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g)
      for (const keyMatch of jsKeyMatches) {
        const key = keyMatch[1]
        if (!calls.has(key)) {
          calls.set(key, { files: [], lines: [] })
        }
        const entry = calls.get(key)!
        if (!entry.files.includes(file)) {
          entry.files.push(file)
          entry.lines.push(parseInt(lineNum))
        }
      }
    }
  } catch {
    // Ignore errors, return what we found
  }

  return calls
}

function findOrphanKeys(
  iniKeys: Map<string, string>,
  usedKeys: Map<string, { files: string[], lines: number[] }>,
  componentPrefix: string
): string[] {
  const orphans: string[] = []

  for (const key of iniKeys.keys()) {
    if (key.startsWith(componentPrefix) && !usedKeys.has(key)) {
      orphans.push(key)
    }
  }

  return orphans
}

export const i18nVerifySchema = z.object({
  componentPath: z.string().describe("Path to Joomla component"),
  sourceIni: z.string().optional().describe("Path to source INI (en-GB). Auto-detected if not provided."),
  targetIni: z.string().optional().describe("Path to target INI. Auto-detected if not provided."),
  targetLanguage: z.string().optional().describe("Target language code (e.g., fr-CA). Default: fr-CA")
})

export type I18nVerifyArgs = z.infer<typeof i18nVerifySchema>

export async function execute(args: I18nVerifyArgs): Promise<string> {
  const componentPath = args.componentPath
  const targetLang = args.targetLanguage || "fr-CA"

  if (!existsSync(componentPath)) {
    return JSON.stringify({ success: false, error: `Component not found: ${componentPath}` })
  }

  const componentMatch = componentPath.match(/com_(\w+)/i)
  const componentName = componentMatch ? componentMatch[1] : basename(componentPath).replace("com_", "")
  const componentPrefix = `COM_${componentName.toUpperCase()}`

  const basePath = componentPath.replace(/\/components\/com_\w+.*$/, "")

  const sourceIniPath = args.sourceIni ||
    join(basePath, `language/en-GB/en-GB.com_${componentName}.ini`)
  const targetIniPath = args.targetIni ||
    join(basePath, `language/${targetLang}/${targetLang}.com_${componentName}.ini`)

  const sourceKeys = parseIniFile(sourceIniPath)
  const targetKeys = parseIniFile(targetIniPath)

  const usedKeys = extractTextCalls(componentPath)

  const missingInSource: MissingKey[] = []
  const missingInTarget: MissingKey[] = []

  for (const [key, usage] of usedKeys.entries()) {
    if (key.startsWith("J") && !key.startsWith(componentPrefix)) continue

    if (!sourceKeys.has(key)) {
      missingInSource.push({
        key,
        file: usage.files[0],
        line: usage.lines[0],
        context: `Used in ${usage.files.length} file(s)`
      })
    }

    if (!targetKeys.has(key) && sourceKeys.has(key)) {
      missingInTarget.push({
        key,
        file: usage.files[0],
        line: usage.lines[0],
        context: `Source value: "${sourceKeys.get(key)?.substring(0, 50)}..."`
      })
    }
  }

  const orphanSource = findOrphanKeys(sourceKeys, usedKeys, componentPrefix)
  const orphanTarget = findOrphanKeys(targetKeys, usedKeys, componentPrefix)

  const issues: string[] = []
  if (missingInSource.length > 0) {
    issues.push(`${missingInSource.length} keys used in PHP but missing in en-GB INI`)
  }
  if (missingInTarget.length > 0) {
    issues.push(`${missingInTarget.length} keys missing translation in ${targetLang}`)
  }
  if (orphanSource.length > 0) {
    issues.push(`${orphanSource.length} orphan keys in en-GB (defined but not used)`)
  }

  const result: VerifyResult = {
    success: missingInSource.length === 0 && missingInTarget.length === 0,
    phpFiles: new Set([...usedKeys.values()].flatMap(u => u.files)).size,
    totalCalls: usedKeys.size,
    uniqueKeys: usedKeys.size,
    missingInSource,
    missingInTarget: missingInTarget.slice(0, 50),
    orphanKeysSource: orphanSource.slice(0, 20).map(k => ({ key: k, iniFile: sourceIniPath })),
    orphanKeysTarget: orphanTarget.slice(0, 20).map(k => ({ key: k, iniFile: targetIniPath })),
    summary: issues.length === 0
      ? `OK: All ${usedKeys.size} keys verified in both INI files`
      : `ISSUES: ${issues.join("; ")}`
  }

  return JSON.stringify(result, null, 2)
}

export const i18nVerifyTool = {
  name: "i18n_verify",
  description: "Verify all Text::_() calls have matching INI keys. Finds missing translations and orphan keys.",
  inputSchema: {
    type: "object" as const,
    properties: {
      componentPath: { type: "string", description: "Path to Joomla component" },
      sourceIni: { type: "string", description: "Path to source INI (en-GB). Auto-detected if not provided." },
      targetIni: { type: "string", description: "Path to target INI. Auto-detected if not provided." },
      targetLanguage: { type: "string", description: "Target language code (e.g., fr-CA). Default: fr-CA" }
    },
    required: ["componentPath"]
  },
  execute
}
