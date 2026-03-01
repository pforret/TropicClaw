#!/usr/bin/env bash
### ==============================================================================
### on-session.sh — Audit log hook for SessionStart / SessionEnd
### Writes session lifecycle events. On end, includes a summary (tool count, errors).
### ==============================================================================
set -euo pipefail

PHASE="${1:-start}"  # start | end
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${AUDITLOG_LOG_DIR:-${SCRIPT_DIR}/logs/sessions}"
[[ ! -d "$LOG_DIR" ]] && mkdir -p "$LOG_DIR"

# Read stdin JSON from Claude Code
INPUT=$(cat)

# ── Extract session_id ────────────────────────────────────────────────────────
if command -v jq &>/dev/null; then
  SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
else
  SESSION=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  SESSION="${SESSION:-unknown}"
fi

LOG_FILE="${LOG_DIR}/${SESSION}.jsonl"
SEQ=0
[[ -f "$LOG_FILE" ]] && SEQ=$(wc -l < "$LOG_FILE")
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ── jq path (preferred) ──────────────────────────────────────────────────────
if command -v jq &>/dev/null; then
  case "$PHASE" in
  start)
    jq -nc \
      --arg ts "$TS" \
      --arg event "session_start" \
      --arg session "$SESSION" \
      --argjson seq "$SEQ" \
      '{ts:$ts,event:$event,session:$session,seq:$seq}' \
      >>"$LOG_FILE"
    ;;

  end)
    # Summarise the session
    TOOL_CALLS=0
    ERRORS=0
    if [[ -f "$LOG_FILE" ]]; then
      TOOL_CALLS=$(grep -c '"event":"tool_call"' "$LOG_FILE" 2>/dev/null || echo 0)
      ERRORS=$(grep -c '"status":"error"' "$LOG_FILE" 2>/dev/null || echo 0)
    fi

    jq -nc \
      --arg ts "$TS" \
      --arg event "session_end" \
      --arg session "$SESSION" \
      --argjson tool_calls "$TOOL_CALLS" \
      --argjson errors "$ERRORS" \
      --argjson seq "$SEQ" \
      '{ts:$ts,event:$event,session:$session,tool_calls:$tool_calls,errors:$errors,seq:$seq}' \
      >>"$LOG_FILE"
    ;;
  esac

# ── fallback path (no jq) ────────────────────────────────────────────────────
else
  echo "{\"ts\":\"${TS}\",\"event\":\"session_${PHASE}\",\"session\":\"${SESSION}\",\"seq\":${SEQ}}" >>"$LOG_FILE"
fi

exit 0
