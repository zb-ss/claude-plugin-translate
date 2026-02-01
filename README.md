# Translate Plugin for Claude Code

Joomla component i18n translation workflows with MCP tools.

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
| auto | `/translate:auto` | Automated translation workflow |
| view | `/translate:view` | View translation differences |
| review | `/translate:review` | Review translations for quality |

## MCP Tools

The plugin provides 13 MCP tools for translation workflows:

### String Detection & Conversion
| Tool | Description |
|------|-------------|
| `i18n_hardcode_finder` | Find hardcoded strings in PHP/HTML/JS files using 700+ regex patterns |
| `i18n_convert` | Convert hardcoded strings to i18n calls with backup/rollback |
| `i18n_extract` | Extract existing Text::_() calls from code |
| `i18n_verify` | Verify all Text::_() calls have matching INI keys |

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
| `workflow_translate_view_done` | Mark view as processed |
| `workflow_translate_review` | Submit review result |
| `workflow_translate_status` | Get workflow status |

## Usage Examples

### Automated Translation
```bash
/translate:auto com_example fr-FR    # Translate component to French
/translate:auto com_lots es-ES       # Translate to Spanish
```

### View Translations
```bash
/translate:view com_example          # View all translations
/translate:view com_example fr-FR    # View specific language
```

### Review Translations
```bash
/translate:review com_example fr-FR  # Review French translations
```

## Features

- 700+ regex patterns for detecting hardcoded strings
- Chunked processing for large files (>500 lines)
- PHP syntax validation after each change
- Automatic backup and rollback on errors
- Locale-specific formatting rules
- Placeholder preservation
- Progress tracking with state persistence
- Workflow orchestration with automatic retry

## Language-Specific Rules

- **fr-CA/fr-FR**: Formal "vous", space before `:;?!`, «guillemets»
- **es-ES**: ¿¡ markers, formal "usted"
- **de-DE**: Capitalize nouns, formal "Sie"

## Requirements

- Joomla component with language files
- PHP for syntax validation
- Node.js 18+ for MCP server

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
