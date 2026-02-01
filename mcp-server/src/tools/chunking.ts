/**
 * Chunking Tools
 *
 * Tools for splitting large files into processable chunks with state tracking.
 * Essential for processing files over 500 lines that would overwhelm LLM context windows.
 *
 * Includes:
 * - file_chunker: Split files into chunks
 * - chunk_reader: Read specific chunks
 * - chunk_state: Update chunk processing state
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { basename } from "path"
import { createHash } from "crypto"
import { z } from "zod"

// Shared interfaces
interface ChunkData {
  id: number
  startLine: number
  endLine: number
  status: "pending" | "completed" | "failed"
  preview?: string
  completedAt?: string
  failedAt?: string
  error?: string
  extractedData?: unknown
}

interface ChunkState {
  filePath: string
  totalLines: number
  totalChunks: number
  chunkSize: number
  overlap: number
  createdAt: string
  updatedAt: string
  chunks: ChunkData[]
}

// ============================================
// File Chunker Tool
// ============================================

export const fileChunkerSchema = z.object({
  filePath: z.string().describe("Absolute path to the file to chunk"),
  chunkSize: z.number().default(150).describe("Number of lines per chunk (default: 150)"),
  overlap: z.number().default(20).describe("Number of overlapping lines between chunks for context (default: 20)"),
  outputDir: z.string().optional().describe("Directory to store state file (default: /tmp/mcp-chunks)")
})

export type FileChunkerArgs = z.infer<typeof fileChunkerSchema>

export async function executeFileChunker(args: FileChunkerArgs): Promise<string> {
  const { filePath, chunkSize = 150, overlap = 20 } = args
  const outputDir = args.outputDir || "/tmp/mcp-chunks"

  if (!existsSync(filePath)) {
    return JSON.stringify({
      success: false,
      error: `File not found: ${filePath}`
    }, null, 2)
  }

  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const totalLines = lines.length

  const chunks: ChunkData[] = []

  let startLine = 1
  let chunkId = 1

  while (startLine <= totalLines) {
    const endLine = Math.min(startLine + chunkSize - 1, totalLines)

    const chunkLines = lines.slice(startLine - 1, endLine)
    const firstNonEmpty = chunkLines.find(l => l.trim().length > 0) || ""
    const preview = firstNonEmpty.substring(0, 80).trim()

    chunks.push({
      id: chunkId,
      startLine,
      endLine,
      status: "pending",
      preview: preview + (firstNonEmpty.length > 80 ? "..." : "")
    })

    startLine = endLine - overlap + 1

    if (startLine <= chunks[chunks.length - 1].startLine) {
      startLine = endLine + 1
    }

    chunkId++
  }

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const fileHash = createHash("md5").update(filePath).digest("hex").substring(0, 8)
  const fileName = basename(filePath).replace(/[^a-zA-Z0-9]/g, "-")
  const stateFileName = `${fileName}-${fileHash}-state.json`
  const stateFilePath = `${outputDir}/${stateFileName}`

  const state: ChunkState = {
    filePath,
    totalLines,
    totalChunks: chunks.length,
    chunkSize,
    overlap,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    chunks
  }

  writeFileSync(stateFilePath, JSON.stringify(state, null, 2))

  return JSON.stringify({
    success: true,
    filePath,
    totalLines,
    totalChunks: chunks.length,
    chunkSize,
    overlap,
    stateFile: stateFilePath,
    chunks: chunks.map(c => ({
      id: c.id,
      startLine: c.startLine,
      endLine: c.endLine,
      lines: c.endLine - c.startLine + 1,
      status: c.status,
      preview: c.preview
    }))
  }, null, 2)
}

export const fileChunkerTool = {
  name: "file_chunker",
  description: "Split large files into processable chunks with state tracking. Essential for processing files over 500 lines that would overwhelm LLM context windows.",
  inputSchema: {
    type: "object" as const,
    properties: {
      filePath: { type: "string", description: "Absolute path to the file to chunk" },
      chunkSize: { type: "number", description: "Number of lines per chunk (default: 150)", default: 150 },
      overlap: { type: "number", description: "Number of overlapping lines between chunks for context (default: 20)", default: 20 },
      outputDir: { type: "string", description: "Directory to store state file (default: /tmp/mcp-chunks)" }
    },
    required: ["filePath"]
  },
  execute: executeFileChunker
}

// ============================================
// Chunk Reader Tool
// ============================================

export const chunkReaderSchema = z.object({
  stateFile: z.string().describe("Path to the state file created by file_chunker"),
  chunkId: z.number().describe("The chunk ID to read (1-based)")
})

export type ChunkReaderArgs = z.infer<typeof chunkReaderSchema>

export async function executeChunkReader(args: ChunkReaderArgs): Promise<string> {
  const { stateFile, chunkId } = args

  if (!existsSync(stateFile)) {
    return JSON.stringify({
      success: false,
      error: `State file not found: ${stateFile}`
    }, null, 2)
  }

  const state: ChunkState = JSON.parse(readFileSync(stateFile, "utf-8"))

  const chunk = state.chunks.find(c => c.id === chunkId)
  if (!chunk) {
    return JSON.stringify({
      success: false,
      error: `Chunk ${chunkId} not found. Valid range: 1-${state.totalChunks}`
    }, null, 2)
  }

  if (!existsSync(state.filePath)) {
    return JSON.stringify({
      success: false,
      error: `Source file not found: ${state.filePath}`
    }, null, 2)
  }

  const content = readFileSync(state.filePath, "utf-8")
  const lines = content.split("\n")

  const startIdx = chunk.startLine - 1
  const endIdx = chunk.endLine
  const chunkLines = lines.slice(startIdx, endIdx)

  let previousContext = ""
  if (chunkId > 1) {
    const prevChunk = state.chunks.find(c => c.id === chunkId - 1)
    if (prevChunk) {
      const prevEndIdx = prevChunk.endLine
      const prevStartIdx = Math.max(prevEndIdx - 5, prevChunk.startLine - 1)
      previousContext = lines.slice(prevStartIdx, prevEndIdx).join("\n")
    }
  }

  let nextContext = ""
  if (chunkId < state.totalChunks) {
    const nextChunk = state.chunks.find(c => c.id === chunkId + 1)
    if (nextChunk) {
      const nextStartIdx = nextChunk.startLine - 1
      const nextEndIdx = Math.min(nextStartIdx + 5, nextChunk.endLine)
      nextContext = lines.slice(nextStartIdx, nextEndIdx).join("\n")
    }
  }

  const numberedContent = chunkLines.map((line, idx) => {
    const lineNum = chunk.startLine + idx
    return `${String(lineNum).padStart(5, " ")} | ${line}`
  }).join("\n")

  return JSON.stringify({
    success: true,
    chunkId,
    filePath: state.filePath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    totalLines: chunk.endLine - chunk.startLine + 1,
    status: chunk.status,
    navigation: {
      isFirst: chunkId === 1,
      isLast: chunkId === state.totalChunks,
      previousChunk: chunkId > 1 ? chunkId - 1 : null,
      nextChunk: chunkId < state.totalChunks ? chunkId + 1 : null,
      totalChunks: state.totalChunks
    },
    context: {
      previousChunkEnding: previousContext || "(start of file)",
      nextChunkStart: nextContext || "(end of file)"
    },
    content: numberedContent,
    rawContent: chunkLines.join("\n")
  }, null, 2)
}

export const chunkReaderTool = {
  name: "chunk_reader",
  description: "Read a specific chunk from a file using state from file_chunker. Returns the chunk content with surrounding context.",
  inputSchema: {
    type: "object" as const,
    properties: {
      stateFile: { type: "string", description: "Path to the state file created by file_chunker" },
      chunkId: { type: "number", description: "The chunk ID to read (1-based)" }
    },
    required: ["stateFile", "chunkId"]
  },
  execute: executeChunkReader
}

// ============================================
// Chunk State Tool
// ============================================

export const chunkStateSchema = z.object({
  stateFile: z.string().describe("Path to the state file created by file_chunker"),
  action: z.enum(["complete", "fail", "reset", "status"]).describe("Action to perform: complete (mark done), fail (mark failed), reset (reset to pending), status (get current status)"),
  chunkId: z.number().optional().describe("Chunk ID to update (required for complete/fail/reset on single chunk)"),
  error: z.string().optional().describe("Error message when marking as failed"),
  data: z.string().optional().describe("JSON string of extracted data to store with the chunk")
})

export type ChunkStateArgs = z.infer<typeof chunkStateSchema>

export async function executeChunkState(args: ChunkStateArgs): Promise<string> {
  const { stateFile, action, chunkId, error } = args

  if (!existsSync(stateFile)) {
    return JSON.stringify({
      success: false,
      error: `State file not found: ${stateFile}`
    }, null, 2)
  }

  const state: ChunkState = JSON.parse(readFileSync(stateFile, "utf-8"))

  if (action === "status") {
    const completed = state.chunks.filter(c => c.status === "completed")
    const failed = state.chunks.filter(c => c.status === "failed")
    const pending = state.chunks.filter(c => c.status === "pending")

    const progress = state.totalChunks > 0
      ? Math.round((completed.length / state.totalChunks) * 100)
      : 0

    return JSON.stringify({
      success: true,
      action: "status",
      filePath: state.filePath,
      totalChunks: state.totalChunks,
      completed: completed.map(c => c.id),
      failed: failed.map(c => ({ id: c.id, error: c.error })),
      pending: pending.map(c => c.id),
      progress: `${progress}%`,
      nextPendingChunk: pending.length > 0 ? pending[0].id : null,
      summary: {
        completedCount: completed.length,
        failedCount: failed.length,
        pendingCount: pending.length
      }
    }, null, 2)
  }

  if (action !== "reset" && chunkId === undefined) {
    return JSON.stringify({
      success: false,
      error: `chunkId is required for action: ${action}`
    }, null, 2)
  }

  if (action === "reset") {
    if (chunkId !== undefined) {
      const chunk = state.chunks.find(c => c.id === chunkId)
      if (!chunk) {
        return JSON.stringify({
          success: false,
          error: `Chunk ${chunkId} not found`
        }, null, 2)
      }
      chunk.status = "pending"
      delete chunk.completedAt
      delete chunk.failedAt
      delete chunk.error
      delete chunk.extractedData
    } else {
      state.chunks.forEach(chunk => {
        chunk.status = "pending"
        delete chunk.completedAt
        delete chunk.failedAt
        delete chunk.error
        delete chunk.extractedData
      })
    }

    state.updatedAt = new Date().toISOString()
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    return JSON.stringify({
      success: true,
      action: "reset",
      chunkId: chunkId ?? "all",
      message: chunkId !== undefined ? `Chunk ${chunkId} reset to pending` : "All chunks reset to pending"
    }, null, 2)
  }

  const chunk = state.chunks.find(c => c.id === chunkId)
  if (!chunk) {
    return JSON.stringify({
      success: false,
      error: `Chunk ${chunkId} not found. Valid range: 1-${state.totalChunks}`
    }, null, 2)
  }

  if (action === "complete") {
    chunk.status = "completed"
    chunk.completedAt = new Date().toISOString()
    delete chunk.failedAt
    delete chunk.error

    if (args.data) {
      try {
        chunk.extractedData = JSON.parse(args.data)
      } catch {
        chunk.extractedData = args.data
      }
    }

    state.updatedAt = new Date().toISOString()
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    const completedCount = state.chunks.filter(c => c.status === "completed").length
    const progress = Math.round((completedCount / state.totalChunks) * 100)

    const nextPending = state.chunks.find(c => c.status === "pending")

    return JSON.stringify({
      success: true,
      action: "complete",
      chunkId,
      progress: `${progress}%`,
      completedCount,
      totalChunks: state.totalChunks,
      nextPendingChunk: nextPending?.id ?? null,
      isComplete: completedCount === state.totalChunks
    }, null, 2)
  }

  if (action === "fail") {
    chunk.status = "failed"
    chunk.failedAt = new Date().toISOString()
    chunk.error = error ?? "Unknown error"
    delete chunk.completedAt

    state.updatedAt = new Date().toISOString()
    writeFileSync(stateFile, JSON.stringify(state, null, 2))

    const nextPending = state.chunks.find(c => c.status === "pending")

    return JSON.stringify({
      success: true,
      action: "fail",
      chunkId,
      error: chunk.error,
      nextPendingChunk: nextPending?.id ?? null,
      message: `Chunk ${chunkId} marked as failed`
    }, null, 2)
  }

  return JSON.stringify({
    success: false,
    error: `Unknown action: ${action}`
  }, null, 2)
}

export const chunkStateTool = {
  name: "chunk_state",
  description: "Update chunk processing state. Use to mark chunks as completed/failed and track progress across sessions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      stateFile: { type: "string", description: "Path to the state file created by file_chunker" },
      action: {
        type: "string",
        enum: ["complete", "fail", "reset", "status"],
        description: "Action to perform: complete (mark done), fail (mark failed), reset (reset to pending), status (get current status)"
      },
      chunkId: { type: "number", description: "Chunk ID to update (required for complete/fail/reset on single chunk)" },
      error: { type: "string", description: "Error message when marking as failed" },
      data: { type: "string", description: "JSON string of extracted data to store with the chunk" }
    },
    required: ["stateFile", "action"]
  },
  execute: executeChunkState
}
