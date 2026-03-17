/**
 * Translation Workflow Orchestration Tools
 *
 * Provides tools for orchestrating Joomla component translation workflows.
 * Manages view-by-view processing with automatic review and retry.
 *
 * Tools:
 * - workflow_translate_init: Initialize a new workflow
 * - workflow_translate_next: Get next view to process
 * - workflow_translate_view_done: Mark view as processed
 * - workflow_translate_review: Submit review result
 * - workflow_translate_status: Get workflow status
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, openSync, closeSync, constants as fsConstants } from "fs"
import { join, basename, dirname } from "path"
import { z } from "zod"

interface ViewInfo {
  path: string
  relativePath: string
  lines: number
  needsChunking: boolean
  status: "pending" | "processing" | "review" | "error" | "done"
  attempts: number
  errors: string[]
  stringsFound: number
  stringsConverted: number
  lastProcessed?: string
}

interface WorkflowState {
  id: string
  componentPath: string
  componentName: string
  targetLanguage: string
  sourceLanguage: string
  sourceIniPath: string
  targetIniPath: string
  sessionId?: string
  created: string
  updated: string
  status: "scanning" | "processing" | "verification" | "browser_verification" | "complete" | "error"
  currentViewIndex: number
  views: ViewInfo[]
  totalStringsConverted: number
  totalErrors: number
  gates?: {
    hardcode_sweep: { status: 'pending' | 'passed' | 'failed'; iteration: number }
    completion_guard: { status: 'pending' | 'passed' | 'failed'; iteration: number }
    browser_verify: { status: 'pending' | 'passed' | 'failed' | 'skipped'; iteration: number }
  }
  browserVerifyConfig?: {
    joomlaUrl: string
    adminUser?: string
    adminPassword?: string
  }
}

// Process-scoped workflow binding — each CC instance gets its own MCP server process,
// so this variable is inherently session-scoped without needing LLM cooperation.
let boundWorkflowId: string | null = null

// Helper functions
import { homedir, tmpdir } from "os"

function getWorkflowDir(): string {
  const home = process.env.HOME || homedir()
  return join(home, ".claude/workflows/translate")
}

function getWorkflowStatePath(workflowId: string): string {
  const baseDir = join(getWorkflowDir(), workflowId)
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true })
  }
  return join(baseDir, "workflow-state.json")
}

/**
 * Acquire an advisory lock for a workflow state file.
 * Uses a .lock file with O_EXCL to prevent concurrent access.
 * Returns the lock file path on success, null on failure.
 */
function acquireLock(workflowId: string, timeoutMs: number = 3000): string | null {
  const lockPath = getWorkflowStatePath(workflowId) + ".lock"
  const deadline = Date.now() + timeoutMs
  const retryInterval = 50

  while (Date.now() < deadline) {
    try {
      // O_EXCL ensures atomic creation — fails if file exists
      const fd = openSync(lockPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL)
      const lockContent = JSON.stringify({ pid: process.pid, acquired: new Date().toISOString() })
      writeFileSync(fd, lockContent)
      closeSync(fd)
      return lockPath
    } catch {
      // Lock exists — check if it's stale (>10s old)
      try {
        const lockContent = readFileSync(lockPath, "utf-8")
        const lockData = JSON.parse(lockContent)
        const lockAge = Date.now() - new Date(lockData.acquired).getTime()
        if (lockAge > 10000) {
          // Stale lock — force remove and retry
          try { unlinkSync(lockPath) } catch {}
          continue
        }
      } catch {
        // Corrupt lock file — remove and retry
        try { unlinkSync(lockPath) } catch {}
        continue
      }

      // Wait and retry
      const waitUntil = Date.now() + retryInterval
      while (Date.now() < waitUntil) { /* busy wait */ }
    }
  }
  return null
}

function releaseLock(lockPath: string): void {
  try { unlinkSync(lockPath) } catch {}
}

function loadWorkflowState(workflowId: string): WorkflowState | null {
  const statePath = getWorkflowStatePath(workflowId)
  if (existsSync(statePath)) {
    return JSON.parse(readFileSync(statePath, "utf-8"))
  }
  return null
}

function saveWorkflowState(state: WorkflowState): void {
  const statePath = getWorkflowStatePath(state.id)
  state.updated = new Date().toISOString()
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

/**
 * Load state with advisory lock. Returns { state, lockPath } or null.
 * Caller MUST call releaseLock(lockPath) when done mutating.
 */
function loadWorkflowStateLocked(workflowId: string): { state: WorkflowState; lockPath: string } | null {
  const lockPath = acquireLock(workflowId)
  if (!lockPath) return null

  const state = loadWorkflowState(workflowId)
  if (!state) {
    releaseLock(lockPath)
    return null
  }

  return { state, lockPath }
}

/**
 * Save state and release advisory lock.
 */
function saveWorkflowStateAndUnlock(state: WorkflowState, lockPath: string): void {
  saveWorkflowState(state)
  releaseLock(lockPath)
}

/**
 * Resolve a workflowId using a 3-tier lookup:
 *   1. Process-scoped in-memory binding (set by workflow_translate_init in this MCP process)
 *   2. Session binding file on disk (/tmp/translate-binding-{sessionId}.json)
 *   3. Global discovery (most recent non-complete workflow directory)
 *
 * Tier 1 is the primary concurrency fix: each CC instance has its own MCP server
 * process, so the in-memory variable is inherently instance-scoped.
 */
function findActiveWorkflow(sessionId?: string): string | null {
  // Tier 1: Process-scoped in-memory binding (most reliable for concurrency)
  if (boundWorkflowId) {
    const state = loadWorkflowState(boundWorkflowId)
    if (state && state.status !== "complete") {
      return boundWorkflowId
    }
    // Workflow completed or deleted — clear stale binding
    boundWorkflowId = null
  }

  // Tier 2: Session binding file on disk
  if (sessionId) {
    const bindingPath = join(tmpdir(), `translate-binding-${sessionId}.json`)
    try {
      if (existsSync(bindingPath)) {
        const binding = JSON.parse(readFileSync(bindingPath, "utf-8"))
        if (binding.workflow_id) {
          const state = loadWorkflowState(binding.workflow_id)
          if (state && state.status !== "complete") {
            // Promote to in-memory binding for future calls
            boundWorkflowId = binding.workflow_id
            return binding.workflow_id
          }
        }
      }
    } catch {
      // Fall through to global discovery
    }
  }

  // Tier 3: Global discovery (finds most recent non-complete workflow)
  const activeDir = getWorkflowDir()
  if (!existsSync(activeDir)) return null

  const dirs = readdirSync(activeDir)
    .filter(d => d.includes("-translate-"))
    .sort()
    .reverse()

  for (const dir of dirs) {
    const state = loadWorkflowState(dir)
    if (state && state.status !== "complete") {
      return dir
    }
  }

  return null
}

function generateWorkflowId(componentName: string): string {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "")
  return `${date}-translate-${componentName}`
}

function getComponentName(componentPath: string): string {
  const match = componentPath.match(/com_(\w+)/i)
  return match ? match[1] : basename(componentPath).replace("com_", "")
}

function findViewFiles(componentPath: string): ViewInfo[] {
  const views: ViewInfo[] = []

  function scanDir(dir: string, baseDir: string) {
    if (!existsSync(dir)) return

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          scanDir(fullPath, baseDir)
        } else if (entry.name.endsWith(".php")) {
          const relativePath = fullPath.replace(baseDir + "/", "")
          const isBackup = /\.(bak|backup|old)\.php$/i.test(entry.name) ||
                          /Old\.php$/i.test(entry.name) ||
                          /_backup\.php$/i.test(entry.name) ||
                          /\.bak$/i.test(entry.name)

          if (!isBackup && (relativePath.includes("tmpl/") || relativePath.includes("layouts/"))) {
            try {
              const content = readFileSync(fullPath, "utf-8")
              const lines = content.split("\n").length
              views.push({
                path: fullPath,
                relativePath,
                lines,
                needsChunking: lines > 500,
                status: "pending",
                attempts: 0,
                errors: [],
                stringsFound: 0,
                stringsConverted: 0
              })
            } catch {
              // Skip unreadable files
            }
          }
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  scanDir(componentPath, componentPath)
  views.sort((a, b) => b.lines - a.lines)

  return views
}

function findLanguageFile(componentPath: string, componentName: string, lang: string): string {
  const possiblePaths = [
    join(dirname(componentPath), "..", "language", lang, `${lang}.com_${componentName}.ini`),
    join(componentPath, "..", "..", "language", lang, `${lang}.com_${componentName}.ini`),
  ]

  for (const p of possiblePaths) {
    if (existsSync(p)) return p
  }

  return possiblePaths[0]
}

function buildChunkingInstructions(view: ViewInfo) {
  return view.needsChunking ? {
    required: true,
    reason: `File has ${view.lines} lines (>500), MUST use chunking`,
    steps: [
      `1. file_chunker(filePath="${view.path}", chunkSize=150, overlap=20)`,
      `2. For EACH chunk (1 to N): i18n_hardcode_finder(filePath="${view.path}", startLine=X, endLine=Y)`,
      `3. Combine all findings, remove duplicates from overlaps`,
      `4. Convert ALL strings found with i18n_convert`,
      `5. DO NOT skip or defer this file - process it completely`
    ]
  } : {
    required: false,
    reason: `File has ${view.lines} lines (<500), can process directly`
  }
}

// ============================================
// Workflow Init Tool
// ============================================

export const workflowInitSchema = z.object({
  componentPath: z.string().describe("Absolute path to the Joomla component"),
  targetLanguage: z.string().describe("Target language code (e.g., fr-CA)"),
  sourceLanguage: z.string().default("en-GB").describe("Source language code"),
  sessionId: z.string().optional().describe("Claude Code session ID for session-scoped tracking"),
  joomlaUrl: z.string().optional().describe("Base URL for Joomla admin panel for browser verification"),
  joomlaUser: z.string().optional().describe("Joomla admin username for browser verification"),
  joomlaPassword: z.string().optional().describe("Joomla admin password for browser verification")
})

export type WorkflowInitArgs = z.infer<typeof workflowInitSchema>

export async function executeWorkflowInit(args: WorkflowInitArgs): Promise<string> {
  const { componentPath, targetLanguage, sourceLanguage = "en-GB", sessionId, joomlaUrl, joomlaUser, joomlaPassword } = args

  if (!existsSync(componentPath)) {
    return JSON.stringify({ success: false, error: `Component not found: ${componentPath}` })
  }

  const componentName = getComponentName(componentPath)
  const workflowId = generateWorkflowId(componentName)

  // Use locking for the resume path since another instance may be active
  const locked = loadWorkflowStateLocked(workflowId)
  const existing = locked?.state ?? null
  const existingLock = locked?.lockPath ?? null

  if (existing && existing.status !== "complete") {
    // Reset orphaned views stuck in "processing" or "review" back to "pending"
    // These are views whose executor died (e.g., context limit) without completing
    let orphansReset = 0
    for (const view of existing.views) {
      if (view.status === "processing" || view.status === "review") {
        view.status = "pending"
        orphansReset++
      }
    }

    // Update sessionId if provided (new session resuming old workflow)
    if (sessionId) {
      existing.sessionId = sessionId
    }

    if (orphansReset > 0 || sessionId) {
      saveWorkflowState(existing)
    }
    if (existingLock) releaseLock(existingLock)

    // Bind this MCP process to the workflow (primary concurrency fix)
    boundWorkflowId = workflowId

    // Write session binding for the new session
    if (sessionId) {
      const bindingPath = join(tmpdir(), `translate-binding-${sessionId}.json`)
      const statePath = getWorkflowStatePath(workflowId)
      try {
        writeFileSync(bindingPath, JSON.stringify({
          session_id: sessionId,
          workflow_path: statePath,
          workflow_id: workflowId,
          bound_at: new Date().toISOString(),
        }) + '\n')
      } catch {
        // Non-fatal
      }
    }

    return JSON.stringify({
      success: true,
      resumed: true,
      workflowId,
      message: orphansReset > 0
        ? `Resuming existing workflow. Reset ${orphansReset} orphaned view(s) back to pending.`
        : `Resuming existing workflow`,
      orphansReset,
      progress: {
        total: existing.views.length,
        done: existing.views.filter(v => v.status === "done").length,
        pending: existing.views.filter(v => v.status === "pending").length
      }
    })
  }

  // Release lock from the existing-but-complete or null case
  if (existingLock) releaseLock(existingLock)

  const views = findViewFiles(componentPath)
  if (views.length === 0) {
    return JSON.stringify({ success: false, error: "No view files found" })
  }

  const state: WorkflowState = {
    id: workflowId,
    componentPath,
    componentName,
    targetLanguage,
    sourceLanguage,
    sourceIniPath: findLanguageFile(componentPath, componentName, sourceLanguage),
    targetIniPath: findLanguageFile(componentPath, componentName, targetLanguage),
    sessionId: sessionId || undefined,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    status: "processing",
    currentViewIndex: 0,
    views,
    totalStringsConverted: 0,
    totalErrors: 0,
    gates: {
      hardcode_sweep: { status: 'pending', iteration: 0 },
      completion_guard: { status: 'pending', iteration: 0 },
      browser_verify: { status: 'pending', iteration: 0 },
    },
    browserVerifyConfig: joomlaUrl ? { joomlaUrl, adminUser: joomlaUser, adminPassword: joomlaPassword } : undefined,
  }

  saveWorkflowState(state)

  // Bind this MCP process to the workflow (primary concurrency fix)
  boundWorkflowId = workflowId

  // Write session binding file for session-scoped stop-guard lookup
  if (sessionId) {
    const bindingPath = join(tmpdir(), `translate-binding-${sessionId}.json`)
    const statePath = getWorkflowStatePath(workflowId)
    try {
      writeFileSync(bindingPath, JSON.stringify({
        session_id: sessionId,
        workflow_path: statePath,
        workflow_id: workflowId,
        bound_at: new Date().toISOString(),
      }) + '\n')
    } catch {
      // Non-fatal: session binding is optional, fallback exists
    }
  }

  return JSON.stringify({
    success: true,
    workflowId,
    componentName,
    targetLanguage,
    sourceLanguage,
    sourceIniPath: state.sourceIniPath,
    targetIniPath: state.targetIniPath,
    browserVerifyConfig: state.browserVerifyConfig || null,
    views: views.map(v => ({
      path: v.relativePath,
      lines: v.lines,
      needsChunking: v.needsChunking
    })),
    totalViews: views.length,
    message: `Workflow created. ${views.length} views to process.`
  }, null, 2)
}

export const workflowInitTool = {
  name: "workflow_translate_init",
  description: "Initialize a new Joomla translation workflow. Scans component and creates view queue.",
  inputSchema: {
    type: "object" as const,
    properties: {
      componentPath: { type: "string", description: "Absolute path to the Joomla component" },
      targetLanguage: { type: "string", description: "Target language code (e.g., fr-CA)" },
      sourceLanguage: { type: "string", description: "Source language code", default: "en-GB" },
      sessionId: { type: "string", description: "Claude Code session ID for session-scoped tracking" },
      joomlaUrl: { type: "string", description: "Base URL for Joomla admin panel for browser verification" },
      joomlaUser: { type: "string", description: "Joomla admin username for browser verification" },
      joomlaPassword: { type: "string", description: "Joomla admin password for browser verification" }
    },
    required: ["componentPath", "targetLanguage"]
  },
  execute: executeWorkflowInit
}

// ============================================
// Workflow Next Tool
// ============================================

export const workflowNextSchema = z.object({
  workflowId: z.string().optional().describe("Workflow ID (auto-detects if not provided)"),
  sessionId: z.string().optional().describe("Session ID for session-scoped workflow lookup")
})

export type WorkflowNextArgs = z.infer<typeof workflowNextSchema>

export async function executeWorkflowNext(args: WorkflowNextArgs): Promise<string> {
  const workflowId = args.workflowId || findActiveWorkflow(args.sessionId)
  if (!workflowId) {
    return JSON.stringify({ success: false, error: "No active workflow found" })
  }

  // Use locked load to prevent concurrent mutation
  const locked = loadWorkflowStateLocked(workflowId)
  if (!locked) {
    return JSON.stringify({ success: false, error: `Workflow not found or locked: ${workflowId}` })
  }
  const { state, lockPath } = locked

  const nextView = state.views.find(v => v.status === "pending" || v.status === "error")

  if (!nextView) {
    const allDone = state.views.every(v => v.status === "done")
    if (allDone) {
      state.status = "verification"
      saveWorkflowStateAndUnlock(state, lockPath)
      return JSON.stringify({
        success: true,
        complete: true,
        message: "All views processed!",
        summary: {
          totalViews: state.views.length,
          stringsConverted: state.totalStringsConverted,
          errors: state.totalErrors
        }
      })
    }
    releaseLock(lockPath)
    return JSON.stringify({ success: false, error: "No views ready to process" })
  }

  nextView.status = "processing"
  nextView.attempts++
  state.currentViewIndex = state.views.indexOf(nextView)
  saveWorkflowStateAndUnlock(state, lockPath)

  const chunkingInstructions = buildChunkingInstructions(nextView)

  const explicitInstructions = [
    "========================================",
    "MANDATORY TARGET FILE - NO SUBSTITUTIONS",
    "========================================",
    `EXACT PATH: ${nextView.path}`,
    `COMPONENT: com_${state.componentName}`,
    `VIEW: ${nextView.relativePath}`,
    "",
    "YOU MUST:",
    `1. Read EXACTLY: ${nextView.path}`,
    `2. Process ONLY: ${nextView.path}`,
    `3. Convert strings in: ${nextView.path}`,
    "",
    "YOU MUST NOT:",
    "- Process any other component (com_lots, com_auction, etc.)",
    "- Process any other view file",
    "- Search for alternative files",
    "========================================"
  ].join("\n")

  return JSON.stringify({
    success: true,
    CRITICAL_TARGET_FILE: nextView.path,
    CRITICAL_COMPONENT: `com_${state.componentName}`,
    explicitInstructions,
    workflowId: state.id,
    componentName: state.componentName,
    targetLanguage: state.targetLanguage,
    sourceLanguage: state.sourceLanguage,
    sourceIniPath: state.sourceIniPath,
    targetIniPath: state.targetIniPath,
    view: {
      path: nextView.path,
      relativePath: nextView.relativePath,
      lines: nextView.lines,
      needsChunking: nextView.needsChunking,
      attempt: nextView.attempts,
      previousErrors: nextView.errors
    },
    chunking: chunkingInstructions,
    progress: {
      current: state.views.indexOf(nextView) + 1,
      total: state.views.length,
      done: state.views.filter(v => v.status === "done").length
    },
    warning: nextView.needsChunking
      ? "LARGE FILE: You MUST use file_chunker. DO NOT skip or defer this file."
      : null
  }, null, 2)
}

export const workflowNextTool = {
  name: "workflow_translate_next",
  description: "Get the next view to process in the translation workflow.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workflowId: { type: "string", description: "Workflow ID (auto-detects if not provided)" },
      sessionId: { type: "string", description: "Session ID for session-scoped workflow lookup" }
    },
    required: []
  },
  execute: executeWorkflowNext
}

// ============================================
// Workflow Next Batch Tool
// ============================================

export const workflowNextBatchSchema = z.object({
  workflowId: z.string().optional().describe("Workflow ID (auto-detects if not provided)"),
  sessionId: z.string().optional().describe("Session ID for session-scoped workflow lookup"),
  batchSize: z.number().min(1).max(4).default(4).describe("Number of views to return (1-4, default 4)")
})

export type WorkflowNextBatchArgs = z.infer<typeof workflowNextBatchSchema>

export async function executeWorkflowNextBatch(args: WorkflowNextBatchArgs): Promise<string> {
  const workflowId = args.workflowId || findActiveWorkflow(args.sessionId)
  if (!workflowId) {
    return JSON.stringify({ success: false, error: "No active workflow found" })
  }

  // Use locked load to prevent concurrent batch assignment
  const locked = loadWorkflowStateLocked(workflowId)
  if (!locked) {
    return JSON.stringify({ success: false, error: `Workflow not found or locked: ${workflowId}` })
  }
  const { state, lockPath } = locked

  const pendingViews = state.views.filter(v => v.status === "pending" || v.status === "error")

  if (pendingViews.length === 0) {
    const allDone = state.views.every(v => v.status === "done")
    if (allDone) {
      state.status = "verification"
      saveWorkflowStateAndUnlock(state, lockPath)
      return JSON.stringify({
        success: true,
        complete: true,
        message: "All views processed!",
        summary: {
          totalViews: state.views.length,
          stringsConverted: state.totalStringsConverted,
          errors: state.totalErrors
        }
      })
    }
    releaseLock(lockPath)
    return JSON.stringify({ success: false, error: "No views ready to process" })
  }

  const batchSize = Math.min(args.batchSize ?? 4, 4, pendingViews.length)
  const batch = pendingViews.slice(0, batchSize)

  // Mark all batch views as processing atomically under lock
  for (const view of batch) {
    view.status = "processing"
    view.attempts++
  }
  saveWorkflowStateAndUnlock(state, lockPath)

  const batchViews = batch.map(view => ({
    path: view.path,
    relativePath: view.relativePath,
    lines: view.lines,
    needsChunking: view.needsChunking,
    attempt: view.attempts,
    previousErrors: view.errors,
    chunking: buildChunkingInstructions(view)
  }))

  const done = state.views.filter(v => v.status === "done").length

  return JSON.stringify({
    success: true,
    workflowId: state.id,
    componentName: state.componentName,
    targetLanguage: state.targetLanguage,
    sourceLanguage: state.sourceLanguage,
    sourceIniPath: state.sourceIniPath,
    targetIniPath: state.targetIniPath,
    batchSize: batch.length,
    views: batchViews,
    progress: {
      total: state.views.length,
      done,
      pending: pendingViews.length - batch.length,
      processing: batch.length
    }
  }, null, 2)
}

export const workflowNextBatchTool = {
  name: "workflow_translate_next_batch",
  description: "Get a batch of up to N pending views for parallel processing. Marks all returned views as 'processing' atomically.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workflowId: { type: "string", description: "Workflow ID (auto-detects if not provided)" },
      sessionId: { type: "string", description: "Session ID for session-scoped workflow lookup" },
      batchSize: { type: "number", description: "Number of views to return (1-4, default 4)", default: 4 }
    },
    required: []
  },
  execute: executeWorkflowNextBatch
}

// ============================================
// Workflow View Done Tool
// ============================================

export const workflowViewDoneSchema = z.object({
  workflowId: z.string().describe("Workflow ID"),
  viewPath: z.string().describe("Path to the view that was processed"),
  stringsFound: z.number().describe("Number of hardcoded strings found"),
  stringsConverted: z.number().describe("Number of strings successfully converted"),
  errors: z.string().optional().describe("JSON array of error messages, if any")
})

export type WorkflowViewDoneArgs = z.infer<typeof workflowViewDoneSchema>

export async function executeWorkflowViewDone(args: WorkflowViewDoneArgs): Promise<string> {
  const locked = loadWorkflowStateLocked(args.workflowId)
  if (!locked) {
    return JSON.stringify({ success: false, error: `Workflow not found or locked: ${args.workflowId}` })
  }
  const { state, lockPath } = locked

  const view = state.views.find(v =>
    v.path === args.viewPath || v.relativePath === args.viewPath
  )
  if (!view) {
    releaseLock(lockPath)
    return JSON.stringify({ success: false, error: `View not found: ${args.viewPath}` })
  }

  if (view.needsChunking && args.stringsFound === 0) {
    releaseLock(lockPath)
    return JSON.stringify({
      success: false,
      error: `REJECTED: Large file (${view.lines} lines) cannot have 0 hardcoded strings. You MUST process this file using chunking.`,
      action: "reprocess_with_chunking",
      instructions: {
        step1: `file_chunker(filePath="${view.path}", chunkSize=150, overlap=20)`,
        step2: "For EACH chunk returned, call i18n_hardcode_finder with startLine and endLine parameters",
        step3: "Combine all findings from all chunks",
        step4: "Convert ALL hardcoded strings found with i18n_convert",
        step5: "Call workflow_translate_view_done with actual counts"
      }
    })
  }

  const expectedMinStrings = Math.floor(view.lines / 100)
  if (view.needsChunking && args.stringsFound < expectedMinStrings) {
    releaseLock(lockPath)
    return JSON.stringify({
      success: false,
      error: `REJECTED: Large file (${view.lines} lines) reported only ${args.stringsFound} strings. Expected at least ${expectedMinStrings}. Did you process ALL chunks?`,
      action: "reprocess_with_chunking",
      instructions: {
        step1: `file_chunker(filePath="${view.path}", chunkSize=150, overlap=20)`,
        step2: "Process EVERY chunk with i18n_hardcode_finder(startLine, endLine)",
        step3: "Do NOT skip any chunks",
        step4: "Report combined total from ALL chunks"
      }
    })
  }

  view.stringsFound = args.stringsFound
  view.stringsConverted = args.stringsConverted
  view.lastProcessed = new Date().toISOString()

  if (args.errors) {
    try {
      view.errors = JSON.parse(args.errors)
    } catch {
      view.errors = [args.errors]
    }
  }

  view.status = "review"
  state.totalStringsConverted += args.stringsConverted
  saveWorkflowStateAndUnlock(state, lockPath)

  return JSON.stringify({
    success: true,
    message: "View marked for review",
    view: view.relativePath,
    stringsConverted: args.stringsConverted,
    needsReview: true
  })
}

export const workflowViewDoneTool = {
  name: "workflow_translate_view_done",
  description: "Mark a view as processed. Call this after processing a view.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workflowId: { type: "string", description: "Workflow ID" },
      viewPath: { type: "string", description: "Path to the view that was processed" },
      stringsFound: { type: "number", description: "Number of hardcoded strings found" },
      stringsConverted: { type: "number", description: "Number of strings successfully converted" },
      errors: { type: "string", description: "JSON array of error messages, if any" }
    },
    required: ["workflowId", "viewPath", "stringsFound", "stringsConverted"]
  },
  execute: executeWorkflowViewDone
}

// ============================================
// Workflow Review Tool
// ============================================

export const workflowReviewSchema = z.object({
  workflowId: z.string().describe("Workflow ID"),
  viewPath: z.string().describe("Path to the view that was reviewed"),
  passed: z.boolean().describe("Whether the review passed"),
  issues: z.string().optional().describe("JSON array of issues found (if failed)")
})

export type WorkflowReviewArgs = z.infer<typeof workflowReviewSchema>

export async function executeWorkflowReview(args: WorkflowReviewArgs): Promise<string> {
  const locked = loadWorkflowStateLocked(args.workflowId)
  if (!locked) {
    return JSON.stringify({ success: false, error: `Workflow not found or locked: ${args.workflowId}` })
  }
  const { state, lockPath } = locked

  const view = state.views.find(v =>
    v.path === args.viewPath || v.relativePath === args.viewPath
  )
  if (!view) {
    releaseLock(lockPath)
    return JSON.stringify({ success: false, error: `View not found: ${args.viewPath}` })
  }

  if (args.passed && view.needsChunking && view.stringsConverted === 0) {
    releaseLock(lockPath)
    return JSON.stringify({
      success: false,
      error: `REJECTED: Cannot pass review for large file (${view.lines} lines) with 0 strings converted.`,
      action: "reprocess_with_chunking"
    })
  }

  if (args.passed) {
    view.status = "done"
    view.errors = []

    const remaining = state.views.filter(v => v.status !== "done").length
    const allDone = remaining === 0

    if (allDone) {
      state.status = "verification"
    }

    saveWorkflowStateAndUnlock(state, lockPath)

    return JSON.stringify({
      success: true,
      passed: true,
      viewComplete: true,
      workflowComplete: allDone,
      remaining,
      message: allDone
        ? "All views complete! Workflow finished."
        : `View passed. ${remaining} views remaining.`
    })
  } else {
    if (args.issues) {
      try {
        view.errors = JSON.parse(args.issues)
      } catch {
        view.errors = [args.issues]
      }
    }

    state.totalErrors++

    if (view.attempts >= 3) {
      view.status = "error"
      saveWorkflowStateAndUnlock(state, lockPath)
      return JSON.stringify({
        success: true,
        passed: false,
        maxAttemptsReached: true,
        message: `View failed after 3 attempts. Marked for manual fix.`,
        errors: view.errors
      })
    }

    view.status = "error"
    saveWorkflowStateAndUnlock(state, lockPath)

    return JSON.stringify({
      success: true,
      passed: false,
      willRetry: true,
      attempt: view.attempts,
      maxAttempts: 3,
      message: `Review failed. Will retry (attempt ${view.attempts}/3).`,
      issues: view.errors
    })
  }
}

export const workflowReviewTool = {
  name: "workflow_translate_review",
  description: "Submit review result for a processed view. Pass or fail.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workflowId: { type: "string", description: "Workflow ID" },
      viewPath: { type: "string", description: "Path to the view that was reviewed" },
      passed: { type: "boolean", description: "Whether the review passed" },
      issues: { type: "string", description: "JSON array of issues found (if failed)" }
    },
    required: ["workflowId", "viewPath", "passed"]
  },
  execute: executeWorkflowReview
}

// ============================================
// Workflow Status Tool
// ============================================

export const workflowStatusSchema = z.object({
  workflowId: z.string().optional().describe("Workflow ID (auto-detects if not provided)"),
  sessionId: z.string().optional().describe("Session ID for session-scoped workflow lookup")
})

export type WorkflowStatusArgs = z.infer<typeof workflowStatusSchema>

export async function executeWorkflowStatus(args: WorkflowStatusArgs): Promise<string> {
  const workflowId = args.workflowId || findActiveWorkflow(args.sessionId)
  if (!workflowId) {
    return JSON.stringify({ success: false, error: "No active workflow found" })
  }

  const state = loadWorkflowState(workflowId)
  if (!state) {
    return JSON.stringify({ success: false, error: `Workflow not found: ${workflowId}` })
  }

  const done = state.views.filter(v => v.status === "done").length
  const pending = state.views.filter(v => v.status === "pending").length
  const error = state.views.filter(v => v.status === "error").length
  const processing = state.views.filter(v => v.status === "processing" || v.status === "review").length

  return JSON.stringify({
    success: true,
    workflowId: state.id,
    componentName: state.componentName,
    targetLanguage: state.targetLanguage,
    status: state.status,
    progress: {
      total: state.views.length,
      done,
      pending,
      error,
      processing,
      percentComplete: Math.round((done / state.views.length) * 100)
    },
    stringsConverted: state.totalStringsConverted,
    totalErrors: state.totalErrors,
    views: state.views.map(v => ({
      path: v.relativePath,
      lines: v.lines,
      status: v.status,
      attempts: v.attempts,
      stringsConverted: v.stringsConverted
    }))
  }, null, 2)
}

export const workflowStatusTool = {
  name: "workflow_translate_status",
  description: "Get the current status of a translation workflow.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workflowId: { type: "string", description: "Workflow ID (auto-detects if not provided)" },
      sessionId: { type: "string", description: "Session ID for session-scoped workflow lookup" }
    },
    required: []
  },
  execute: executeWorkflowStatus
}

// ============================================
// Workflow Gate Update Tool
// ============================================

export const workflowGateUpdateSchema = z.object({
  workflowId: z.string().describe("Workflow ID"),
  gateName: z.enum(['hardcode_sweep', 'completion_guard', 'browser_verify']).describe("Gate to update"),
  status: z.enum(['pending', 'passed', 'failed', 'skipped']).describe("New status"),
})

export type WorkflowGateUpdateArgs = z.infer<typeof workflowGateUpdateSchema>

export async function executeWorkflowGateUpdate(args: WorkflowGateUpdateArgs): Promise<string> {
  const locked = loadWorkflowStateLocked(args.workflowId)
  if (!locked) {
    return JSON.stringify({ success: false, error: `Workflow not found or locked: ${args.workflowId}` })
  }
  const { state, lockPath } = locked

  if (!state.gates) {
    state.gates = {
      hardcode_sweep: { status: 'pending', iteration: 0 },
      completion_guard: { status: 'pending', iteration: 0 },
      browser_verify: { status: 'pending', iteration: 0 },
    }
  }

  const gate = state.gates[args.gateName]
  // Use type assertion: browser_verify accepts 'skipped', others don't, but runtime is safe
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(state.gates as any)[args.gateName] = {
    status: args.status,
    iteration: (gate?.iteration || 0) + 1,
  }

  // If completion guard passes, move to browser verification phase
  if (args.gateName === 'completion_guard' && args.status === 'passed') {
    state.status = 'browser_verification'
  }
  // If browser verify passes or is skipped, set workflow status to complete
  if (args.gateName === 'browser_verify' && (args.status === 'passed' || args.status === 'skipped')) {
    state.status = 'complete'
  }

  saveWorkflowStateAndUnlock(state, lockPath)

  return JSON.stringify({
    success: true,
    gate: args.gateName,
    status: args.status,
    iteration: state.gates[args.gateName].iteration,
  })
}

export const workflowGateUpdateTool = {
  name: "workflow_translate_gate_update",
  description: "Update a quality gate status in the translation workflow. Used by orchestrator after verification passes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      workflowId: { type: "string", description: "Workflow ID" },
      gateName: { type: "string", enum: ["hardcode_sweep", "completion_guard", "browser_verify"], description: "Gate to update" },
      status: { type: "string", enum: ["pending", "passed", "failed", "skipped"], description: "New status" },
    },
    required: ["workflowId", "gateName", "status"]
  },
  execute: executeWorkflowGateUpdate
}
