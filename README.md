# Translate Plugin for Claude Code

Joomla component i18n translation workflows with MCP tools. Supports parallel multi-instance translation of different components and optional browser-based verification via Playwright.

## Installation

### From Marketplace (Recommended)

In Claude Code, run:

```
/plugin marketplace add zb-ss/claude-plugin-translate
/plugin install translate@zb-ss-translate
```

### Manual Installation

1. Clone/download this repository to your Claude plugins directory:
   ```bash
   cd ~/.claude/plugins
   git clone https://github.com/zb-ss/claude-plugin-translate translate
   ```

2. The plugin includes a pre-built MCP server bundle (`mcp-server/dist/bundle.mjs`) that works immediately - no npm install required.

3. Restart Claude Code to load the plugin.

### For Development

If you want to modify the MCP tools:

```bash
cd mcp-server
npm install
npm run build   # Compiles TypeScript and creates bundle
```

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| auto | `/translate:auto` | Fully automatic parallel translation workflow |
| view | `/translate:view` | Process a single view file for translation |
| review | `/translate:review` | Review code for i18n compliance |

## Auto Translation (`/translate:auto`)

The main workflow. Translates an entire Joomla component by processing view files in parallel batches with multi-stage quality verification.

### Usage

```bash
/translate:auto <component_path> <target_language> [options]
```

### Required Arguments

- `<component_path>` — Absolute path to the Joomla component directory
- `<target_language>` — Target language code (e.g., `fr-CA`, `es-ES`, `de-DE`)

### Optional Arguments

| Flag | Description |
|------|-------------|
| `--resume` | Resume from last incomplete view |
| `--dry-run` | Analyze without making changes |
| `--skip-review` | Skip the review step after each view |
| `--joomla-url <url>` | Joomla admin URL for browser verification |
| `--joomla-user <user>` | Joomla admin username |
| `--joomla-password <pass>` | Joomla admin password |
| `--skip-browser` | Skip browser verification step |

### Examples

```bash
# Basic translation
/translate:auto /var/www/joomla/administrator/components/com_lots fr-CA

# With browser verification
/translate:auto /path/to/com_auction fr-CA \
  --joomla-url http://localhost/administrator \
  --joomla-user admin \
  --joomla-password secret

# Resume interrupted workflow
/translate:auto /path/to/com_auction fr-CA --resume

# Dry run
/translate:auto ./components/com_inventory es-ES --dry-run
```

### Workflow Pipeline

```
Init → Batch Processing → Per-View Hardcode Sweep → Completion Guard → Browser Verify → Done
```

| Phase | Description |
|-------|-------------|
| **Init** | Scan component, discover view files, create workflow state |
| **Batch Processing** | Process views in parallel batches of up to 4 |
| **Hardcode Sweep** | Per-view verification with fix-and-retry loop (max 3 attempts, escalates to opus) |
| **Completion Guard** | Final zero-tolerance scan of ALL files by opus |
| **Browser Verify** | Load views in real browser, check for raw keys, JS errors, untranslated text (optional, requires `--joomla-url`) |

### Quality Gates

| Gate | Model | Blocking | Description |
|------|-------|----------|-------------|
| `hardcode_sweep` | sonnet | Yes | Per-view scan after each batch |
| `completion_guard` | opus | Yes | Full-component scan after all views done |
| `browser_verify` | sonnet | Yes | Browser-based visual verification (skipped if no URL) |

## Multi-Instance Support

Multiple Claude Code instances can translate different components simultaneously in the same repository. Each instance:

- Gets its own MCP server process with an in-memory workflow binding
- Has session-scoped stop-guard (won't block other sessions)
- Uses advisory file locking on workflow state writes
- Creates session binding files in `/tmp/translate-binding-{sessionId}.json`

### Running Parallel Translations

Open separate terminals and run `/translate:auto` in each with a different component:

```bash
# Terminal 1
/translate:auto /path/to/com_auction fr-CA

# Terminal 2
/translate:auto /path/to/com_invoice fr-CA

# Terminal 3
/translate:auto /path/to/com_catalog fr-CA
```

Each instance tracks its own workflow independently.

## Agents

| Agent | Description |
|-------|-------------|
| `translate:orchestrator` | Coordinates the full workflow, spawns executors, manages gates |
| `translate:hardcode-sweep` | Aggressive re-scan for hardcoded strings with dual-method detection |
| `translate:completion-guard` | Final zero-tolerance verification before completion |
| `translate:browser-verify` | Browser-based verification using Playwright/Chrome DevTools MCP |

## MCP Tools

### String Detection & Conversion

| Tool | Description |
|------|-------------|
| `i18n_hardcode_finder` | Find hardcoded strings in PHP/HTML/JS files using 700+ regex patterns |
| `i18n_convert` | Convert hardcoded strings to i18n calls with backup/rollback |
| `i18n_extract` | Extract existing `Text::_()` calls from code |
| `i18n_verify` | Verify all `Text::_()` calls have matching INI keys |

### INI File Management

| Tool | Description |
|------|-------------|
| `ini_builder` | Create, add, validate, and diff INI language files |

### Chunking (Large Files)

| Tool | Description |
|------|-------------|
| `file_chunker` | Split large files into processable chunks |
| `chunk_reader` | Read specific chunks with context |
| `chunk_state` | Track chunk processing progress |

### Workflow Orchestration

| Tool | Description |
|------|-------------|
| `workflow_translate_init` | Initialize translation workflow for a component |
| `workflow_translate_next` | Get next view to process |
| `workflow_translate_next_batch` | Get batch of up to 4 views for parallel processing |
| `workflow_translate_view_done` | Mark view as processed |
| `workflow_translate_review` | Submit review result |
| `workflow_translate_status` | Get workflow status |
| `workflow_translate_gate_update` | Update quality gate status (hardcode_sweep, completion_guard, browser_verify) |

## Hooks

| Hook | Event | Description |
|------|-------|-------------|
| `session-start.js` | SessionStart | Injects active workflow context (session-scoped) |
| `stop-guard.js` | Stop | Blocks premature session exit while workflow is active (session-scoped) |
| `approve-mcp.sh` | PreToolUse | Auto-approves MCP tool calls |
| `approve-bash.sh` | PreToolUse | Auto-approves safe bash commands (php -l, etc.) |

## Statusline

When a translate workflow is active, the Claude Code status bar shows:

```
Opus 4.6 │ 5h ████████░░ 86% │ i18n auction ██████░░ 47/52 4active
```

Shows component name, progress bar, done/total count, active executors, and a `STALE` warning if the workflow hasn't updated in 5+ minutes.

## Features

- 700+ regex patterns for detecting hardcoded strings
- Parallel batch processing (up to 4 views simultaneously)
- Chunked processing for large files (>500 lines)
- Multi-stage quality verification (code analysis + browser testing)
- PHP syntax validation after each change
- Automatic backup and rollback on errors
- Session-scoped concurrency for multi-instance support
- Advisory file locking on shared state
- Locale-specific formatting rules
- Placeholder preservation
- Progress tracking with state persistence and statusline display
- Workflow orchestration with automatic retry and opus escalation

## Language-Specific Rules

- **fr-CA/fr-FR**: Formal "vous", space before `:;?!`, «guillemets»
- **es-ES**: ¿¡ markers, formal "usted"
- **de-DE**: Capitalize nouns, formal "Sie"

## Requirements

- Joomla component with language files
- PHP for syntax validation
- Node.js 18+ for MCP server
- Playwright MCP (optional, for browser verification)

## Development

The MCP server is bundled into a single file for easy distribution. To modify:

```bash
cd mcp-server
npm install           # Install dev dependencies
npm run build         # Compile TypeScript + bundle
npm run dev           # Watch mode for TypeScript (no auto-bundle)
```

The bundle (`dist/bundle.mjs`) is self-contained and requires only Node.js 18+ to run.

## License

MIT
