#!/usr/bin/env bash
### ==============================================================================
### on-tool-use.sh — Audit log hook for PreToolUse / PostToolUse / PostToolUseFailure
### Appends a single JSON-lines entry per invocation. Must be FAST.
### ==============================================================================
set -euo pipefail

PHASE="${1:-post}"  # pre | post | failure
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${AUDITLOG_LOG_DIR:-${SCRIPT_DIR}/logs/sessions}"
[[ ! -d "$LOG_DIR" ]] && mkdir -p "$LOG_DIR"

# Read stdin JSON from Claude Code
INPUT=$(cat)

# ── jq path (preferred) ──────────────────────────────────────────────────────
if command -v jq &>/dev/null; then
  TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
  SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
  LOG_FILE="${LOG_DIR}/${SESSION}.jsonl"
  SEQ=0
  [[ -f "$LOG_FILE" ]] && SEQ=$(wc -l < "$LOG_FILE")

  case "$PHASE" in
  pre)
    # Summarize tool input — pick the most descriptive field, truncate to 200 chars
    INPUT_SUMMARY=$(echo "$INPUT" | jq -r '
      .tool_input //= {} |
      .tool_input |
      if .command then .command[0:200]
      elif .file_path then .file_path[0:200]
      elif .pattern then .pattern[0:200]
      elif .query then .query[0:200]
      elif .url then .url[0:200]
      elif .skill then .skill[0:200]
      elif .prompt then .prompt[0:200]
      else (tostring | .[0:200])
      end' 2>/dev/null || echo "")

    jq -nc \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg event "tool_call" \
      --arg session "$SESSION" \
      --arg tool "$TOOL" \
      --arg summary "$INPUT_SUMMARY" \
      --argjson seq "$SEQ" \
      '{ts:$ts,event:$event,session:$session,tool:$tool,input_summary:$summary,seq:$seq}' \
      >>"$LOG_FILE"
    ;;

  post)
    OUTPUT_LINES=$(echo "$INPUT" | jq -r '
      .tool_output // "" |
      if type == "string" then split("\n") | length
      else 0
      end' 2>/dev/null || echo "0")

    jq -nc \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg event "tool_result" \
      --arg session "$SESSION" \
      --arg tool "$TOOL" \
      --arg status "success" \
      --argjson output_lines "${OUTPUT_LINES:-0}" \
      --argjson seq "$SEQ" \
      '{ts:$ts,event:$event,session:$session,tool:$tool,status:$status,output_lines:$output_lines,seq:$seq}' \
      >>"$LOG_FILE"
    ;;

  failure)
    ERROR=$(echo "$INPUT" | jq -r '.tool_output // "unknown error"' | head -c 500)

    jq -nc \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg event "tool_result" \
      --arg session "$SESSION" \
      --arg tool "$TOOL" \
      --arg status "error" \
      --arg error "$ERROR" \
      --argjson seq "$SEQ" \
      '{ts:$ts,event:$event,session:$session,tool:$tool,status:$status,error:$error,seq:$seq}' \
      >>"$LOG_FILE"
    ;;
  esac

# ── fallback path (no jq) ────────────────────────────────────────────────────
else
  SESSION=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  SESSION="${SESSION:-unknown}"
  TOOL=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)
  TOOL="${TOOL:-unknown}"
  LOG_FILE="${LOG_DIR}/${SESSION}.jsonl"
  SEQ=0
  [[ -f "$LOG_FILE" ]] && SEQ=$(wc -l < "$LOG_FILE")
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  case "$PHASE" in
  pre)     EVENT="tool_call" ;;
  post)    EVENT="tool_result" ;;
  failure) EVENT="tool_error" ;;
  *)       EVENT="unknown" ;;
  esac

  echo "{\"ts\":\"${TS}\",\"event\":\"${EVENT}\",\"session\":\"${SESSION}\",\"tool\":\"${TOOL}\",\"seq\":${SEQ}}" >>"$LOG_FILE"
fi

exit 0
