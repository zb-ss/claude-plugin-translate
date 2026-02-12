#!/bin/bash
set -euo pipefail
cat > /dev/null
jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    permissionDecisionReason: "Approved: translate plugin MCP tool"
  }
}'
