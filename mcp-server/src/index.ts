#!/usr/bin/env node

/**
 * MCP Server for Joomla Translation Workflow
 *
 * Provides tools for:
 * - Finding hardcoded strings in PHP/HTML/JS files
 * - Converting hardcoded strings to i18n calls
 * - Building and validating INI language files
 * - Chunking large files for processing
 * - Extracting and verifying i18n strings
 * - Orchestrating translation workflows
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

// Import all tools
import { i18nHardcodeFinderTool } from "./tools/i18n-hardcode-finder.js"
import { i18nConvertTool } from "./tools/i18n-convert.js"
import { iniBuilderTool } from "./tools/ini-builder.js"
import { fileChunkerTool, chunkReaderTool, chunkStateTool } from "./tools/chunking.js"
import { i18nExtractTool } from "./tools/i18n-extract.js"
import { i18nVerifyTool } from "./tools/i18n-verify.js"
import {
  workflowInitTool,
  workflowNextTool,
  workflowNextBatchTool,
  workflowViewDoneTool,
  workflowReviewTool,
  workflowStatusTool
} from "./tools/workflow.js"

// Collect all tools
const tools = [
  i18nHardcodeFinderTool,
  i18nConvertTool,
  iniBuilderTool,
  fileChunkerTool,
  chunkReaderTool,
  chunkStateTool,
  i18nExtractTool,
  i18nVerifyTool,
  workflowInitTool,
  workflowNextTool,
  workflowNextBatchTool,
  workflowViewDoneTool,
  workflowReviewTool,
  workflowStatusTool
]

// Create a map for quick tool lookup
const toolMap = new Map(tools.map(tool => [tool.name, tool]))

// Create server
const server = new Server(
  {
    name: "joomla-translate",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }
})

// Handle call tool request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  const tool = toolMap.get(name)
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`)
  }

  try {
    const result = await tool.execute(args as never)
    return {
      content: [
        {
          type: "text",
          text: result
        }
      ]
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: false, error: errorMessage }, null, 2)
        }
      ],
      isError: true
    }
  }
})

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("Joomla Translate MCP Server running on stdio")
}

main().catch((error) => {
  console.error("Server error:", error)
  process.exit(1)
})
