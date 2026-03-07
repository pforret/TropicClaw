#!/bin/bash
# PreToolUse hook for tier-based tool blocking
# TRUST_TIER env var set by gateway before spawning claude -p

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name')
TIER="${TRUST_TIER:-0}"

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

case "$TOOL" in
  Read|Glob|Grep|WebSearch|WebFetch)
    # Tier 0+ (read-only)
    ;;
  Write|Edit|NotebookEdit)
    [[ $TIER -lt 1 ]] && deny "Write operations require trust tier 1+"
    ;;
  Bash)
    COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
    [[ $TIER -lt 1 ]] && deny "Bash requires trust tier 1+"
    if echo "$COMMAND" | grep -qE 'rm -rf|DROP TABLE|git push --force|mkfs|dd if='; then
      [[ $TIER -lt 3 ]] && deny "Destructive command requires trust tier 3"
    fi
    ;;
  mcp__*)
    [[ $TIER -lt 2 ]] && deny "MCP tools (network) require trust tier 2+"
    ;;
esac

# Default: allow
exit 0
