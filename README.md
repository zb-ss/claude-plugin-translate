# Translate Plugin for Claude Code

Joomla component i18n translation workflows.

## Installation

Add to your Claude Code configuration:

```bash
claude --plugin-dir /path/to/translate
```

Or add to your settings:

```json
{
  "plugins": ["/path/to/translate"]
}
```

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| auto | `/translate:auto` | Automated translation workflow |
| view | `/translate:view` | View translation differences |
| review | `/translate:review` | Review translations for quality |

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

- Chunked processing for large files
- PHP syntax validation after each change
- Locale-specific formatting rules
- Placeholder preservation
- Progress tracking

## Language-Specific Rules

- **fr-CA/fr-FR**: Formal "vous", space before `:;?!`, «guillemets»
- **es-ES**: ¿¡ markers, formal "usted"
- **de-DE**: Capitalize nouns, formal "Sie"

## Requirements

- Joomla component with language files
- PHP for syntax validation

## License

MIT
