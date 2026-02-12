#!/bin/bash
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [[ "$COMMAND" =~ ^php\ -l ]] || \
   [[ "$COMMAND" =~ ^git\ checkout\ -b\ feature/translate/ ]] || \
   [[ "$COMMAND" =~ ^git\ branch ]]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "Approved: translate workflow bash command"
    }
  }'
fi
