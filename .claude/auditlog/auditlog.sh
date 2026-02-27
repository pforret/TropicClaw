#!/usr/bin/env bash
### ==============================================================================
### auditlog — Append-Only Audit Logging for Claude Code Sessions
### Records every tool call, session start/end as JSON-lines via Claude Code hooks.
### Provides CLI for querying, searching, and managing audit logs.
### ==============================================================================
###
### FOR LLMs: QUICK REFERENCE
### -------------------------
### ADDING NEW VERBS: In Option:config(), add verb to the choice line
###                   then add a case block in Script:main(): newverb) do_newverb ;;
###
### HOOK ARCHITECTURE:
###   Claude Code hooks → hooks/on-tool-use.sh (pre|post|failure)
###                     → hooks/on-session.sh  (start|end)
###   Hooks append JSON-lines to logs/sessions/<session-id>.jsonl
###   This CLI reads those files for querying/management.
###
### LOG FORMAT (JSON-lines, one entry per line):
###   {"ts":"2026-02-27T14:30:45Z","event":"tool_call","session":"abc","tool":"Bash","input_summary":"git status","seq":1}
###   {"ts":"2026-02-27T14:30:47Z","event":"tool_result","session":"abc","tool":"Bash","status":"success","output_lines":15,"seq":2}
###   {"ts":"2026-02-27T14:30:45Z","event":"session_start","session":"abc","seq":0}
###   {"ts":"2026-02-27T14:31:00Z","event":"session_end","session":"abc","tool_calls":5,"errors":0,"seq":6}
### ==============================================================================

### Created by Peter Forret ( pforret ) on 2026-02-27
### Based on https://github.com/pforret/bashew 1.22.1
script_version="0.1.0"
readonly script_author="peter@forret.com"
readonly script_created="2026-02-27"
readonly run_as_root=0
readonly script_description="Append-only audit logging for Claude Code sessions"

function Option:config() {
  grep <<<"
flag|h|help|show usage
flag|Q|QUIET|no output
flag|V|VERBOSE|also show debug messages
flag|f|FORCE|do not ask for confirmation (always yes)
option|L|LOG_DIR|folder for session logs|${AUDITLOG_LOG_DIR:-}
option|T|TMP_DIR|folder for temp files|/tmp/auditlog
option|F|FORMAT|export format (json, csv, text)|json
option|D|DAYS|max age in days for clean|30
option|N|LINES|number of lines for tail|20
choice|1|action|action to perform|status,search,list,stats,export,tail,clean,install,uninstall,check
param|?|input|query, session id, or subcommand (sessions, tools, errors)
" -v -e '^#' -e '^\s*$'
}

#####################################################################
## Main script
#####################################################################

function Script:main() {
  IO:log "[$script_basename] $script_version started"

  # Default LOG_DIR to logs/sessions subfolder of script location
  [[ -z "$LOG_DIR" ]] && LOG_DIR="$script_install_folder/logs/sessions"

  # Override log_file to avoid polluting session JSONL files
  # (bashew's Script:initialize sets log_file in LOG_DIR, but we need it separate)
  log_file="$script_install_folder/logs/auditlog.$execution_day.log"
  mkdir -p "$script_install_folder/logs"

  case "${action,,}" in
  status)
    #TIP: use «$script_prefix status» to show audit logging status
    #TIP:> $script_prefix status
    do_status
    ;;
  search)
    #TIP: use «$script_prefix search <query>» to search all audit logs
    #TIP:> $script_prefix search "Bash"
    do_search "$input"
    ;;
  list)
    #TIP: use «$script_prefix list» to list sessions (default), tools, or errors
    #TIP:> $script_prefix list sessions
    #TIP:> $script_prefix list tools
    #TIP:> $script_prefix list errors
    do_list "${input:-sessions}"
    ;;
  stats)
    #TIP: use «$script_prefix stats [session-id]» to show tool usage statistics
    #TIP:> $script_prefix stats
    #TIP:> $script_prefix stats abc123
    do_stats "$input"
    ;;
  export)
    #TIP: use «$script_prefix export [session-id]» to export logs (--FORMAT json|csv|text)
    #TIP:> $script_prefix export
    #TIP:> $script_prefix export abc123 --FORMAT csv
    do_export "$input"
    ;;
  tail)
    #TIP: use «$script_prefix tail [session-id]» to show recent log entries
    #TIP:> $script_prefix tail
    do_tail "$input"
    ;;
  clean)
    #TIP: use «$script_prefix clean» to remove logs older than --DAYS days (default 30)
    #TIP:> $script_prefix clean --DAYS 7 --FORCE
    do_clean
    ;;
  install)
    #TIP: use «$script_prefix install» to register hooks in settings.local.json
    #TIP:> $script_prefix install
    do_install
    ;;
  uninstall)
    #TIP: use «$script_prefix uninstall» to remove hooks from settings.local.json
    #TIP:> $script_prefix uninstall
    do_uninstall
    ;;
  check)
    #TIP: use «$script_prefix check» to verify dependencies and hook registration
    #TIP:> $script_prefix check
    do_check
    ;;
  *)
    IO:die "action [$action] not recognized"
    ;;
  esac
  IO:log "[$script_basename] ended after $SECONDS secs"
}

#####################################################################
## Helper functions
#####################################################################

function get_session_dir() {
  echo "$LOG_DIR"
}

function get_settings_file() {
  # Find git root and return settings.local.json path
  local git_root
  git_root=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -n "$git_root" ]]; then
    echo "$git_root/.claude/settings.local.json"
  else
    echo "$script_install_folder/../settings.local.json"
  fi
}

function count_sessions() {
  local session_dir
  session_dir=$(get_session_dir)
  if [[ -d "$session_dir" ]]; then
    find "$session_dir" -name "*.jsonl" -type f 2>/dev/null | wc -l | xargs
  else
    echo 0
  fi
}

function count_entries() {
  local file="$1"
  if [[ -f "$file" ]]; then
    wc -l <"$file" | xargs
  else
    echo 0
  fi
}

function total_entries() {
  local session_dir
  session_dir=$(get_session_dir)
  if [[ -d "$session_dir" ]]; then
    cat "$session_dir"/*.jsonl 2>/dev/null | wc -l | xargs
  else
    echo 0
  fi
}

function dir_size() {
  local session_dir
  session_dir=$(get_session_dir)
  if [[ -d "$session_dir" ]]; then
    du -sh "$session_dir" 2>/dev/null | cut -f1 | xargs
  else
    echo "0"
  fi
}

function format_duration() {
  local seconds=$1
  if [[ $seconds -lt 60 ]]; then
    echo "${seconds}s"
  elif [[ $seconds -lt 3600 ]]; then
    echo "$((seconds / 60))m $((seconds % 60))s"
  else
    echo "$((seconds / 3600))h $((seconds % 3600 / 60))m"
  fi
}

function hooks_installed() {
  local settings_file
  settings_file=$(get_settings_file)
  if [[ -f "$settings_file" ]] && command -v jq &>/dev/null; then
    # Check if any hook references auditlog
    if jq -e '.hooks // {} | to_entries[] | .value[]?.hooks[]?.command // "" | test("auditlog")' "$settings_file" &>/dev/null; then
      return 0
    fi
  fi
  return 1
}

function find_session_file() {
  local session_id="$1"
  local session_dir
  session_dir=$(get_session_dir)

  # Exact match
  if [[ -f "${session_dir}/${session_id}.jsonl" ]]; then
    echo "${session_dir}/${session_id}.jsonl"
    return 0
  fi

  # Prefix match
  local matches
  matches=$(find "$session_dir" -name "${session_id}*.jsonl" -type f 2>/dev/null)
  if [[ -n "$matches" ]]; then
    echo "$matches" | head -1
    return 0
  fi

  return 1
}

#####################################################################
## Command implementations
#####################################################################

function do_status() {
  IO:print "## Audit Log Status"
  IO:print ""

  # Hook status
  if hooks_installed; then
    IO:print "Hooks     : ${txtInfo}installed${txtReset}"
  else
    IO:print "Hooks     : ${txtWarn}not installed${txtReset} (run: $script_basename install)"
  fi

  # Log directory
  local session_dir
  session_dir=$(get_session_dir)
  IO:print "Log dir   : $session_dir"

  # Statistics
  local sessions entries size
  sessions=$(count_sessions)
  entries=$(total_entries)
  size=$(dir_size)

  IO:print "Sessions  : $sessions"
  IO:print "Entries   : $entries"
  IO:print "Disk size : $size"

  # Most recent session
  if [[ "$sessions" -gt 0 ]]; then
    local latest
    latest=$(ls -t "$session_dir"/*.jsonl 2>/dev/null | head -1)
    if [[ -n "$latest" ]]; then
      local latest_name latest_entries latest_time
      latest_name=$(basename "$latest" .jsonl)
      latest_entries=$(count_entries "$latest")
      latest_time=$(head -1 "$latest" | jq -r '.ts // "?"' 2>/dev/null || echo "?")
      IO:print ""
      IO:print "Latest    : ${latest_name} (${latest_entries} entries, started ${latest_time})"
    fi
  fi
}

function do_search() {
  local query="$1"
  [[ -z "$query" ]] && IO:die "Usage: $script_basename search <query>"

  local session_dir
  session_dir=$(get_session_dir)
  [[ ! -d "$session_dir" ]] && IO:print "No audit logs found." && return 0

  IO:print "## Search: \"$query\""
  IO:print ""

  local match_count=0
  local file_count=0

  for log_file in "$session_dir"/*.jsonl; do
    [[ ! -f "$log_file" ]] && continue
    local matches
    matches=$(grep -i "$query" "$log_file" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      ((file_count++))
      local session_name
      session_name=$(basename "$log_file" .jsonl)
      IO:print "${txtBold}Session: ${session_name}${txtReset}"

      while IFS= read -r line; do
        ((match_count++))
        if command -v jq &>/dev/null; then
          local ts event tool summary
          ts=$(echo "$line" | jq -r '.ts // ""' 2>/dev/null)
          event=$(echo "$line" | jq -r '.event // ""' 2>/dev/null)
          tool=$(echo "$line" | jq -r '.tool // ""' 2>/dev/null)
          summary=$(echo "$line" | jq -r '.input_summary // .error // ""' 2>/dev/null)
          printf "  %s  %-14s %-10s %s\n" "$ts" "$event" "$tool" "$summary"
        else
          echo "  $line"
        fi
      done <<<"$matches"
      IO:print ""
    fi
  done

  IO:print "Found $match_count match(es) across $file_count session(s)."
}

function do_list() {
  local subcommand="${1:-sessions}"
  local session_dir
  session_dir=$(get_session_dir)
  [[ ! -d "$session_dir" ]] && IO:print "No audit logs found." && return 0

  case "${subcommand,,}" in
  sessions)
    IO:print "## Sessions"
    IO:print ""
    printf "%-40s %-22s %-8s %-8s %s\n" "Session ID" "Started" "Entries" "Tools" "Errors"
    printf "%-40s %-22s %-8s %-8s %s\n" "----------" "-------" "-------" "-----" "------"

    for log_file in $(ls -t "$session_dir"/*.jsonl 2>/dev/null); do
      [[ ! -f "$log_file" ]] && continue
      local session_name entries tools errors started
      session_name=$(basename "$log_file" .jsonl)
      entries=$(count_entries "$log_file")

      if command -v jq &>/dev/null; then
        started=$(head -1 "$log_file" | jq -r '.ts // "?"' 2>/dev/null)
        tools=$(grep -c '"event":"tool_call"' "$log_file" 2>/dev/null || echo 0)
        errors=$(grep -c '"status":"error"' "$log_file" 2>/dev/null || echo 0)
      else
        started=$(head -1 "$log_file" | grep -o '"ts":"[^"]*"' | head -1 | cut -d'"' -f4)
        tools=$(grep -c 'tool_call' "$log_file" 2>/dev/null || echo 0)
        errors=$(grep -c '"error"' "$log_file" 2>/dev/null || echo 0)
      fi

      # Truncate session name for display
      local display_name="$session_name"
      [[ ${#display_name} -gt 38 ]] && display_name="${display_name:0:35}..."

      printf "%-40s %-22s %-8s %-8s %s\n" "$display_name" "${started:-?}" "$entries" "$tools" "$errors"
    done
    ;;

  tools)
    IO:print "## Tool Usage (all sessions)"
    IO:print ""

    if command -v jq &>/dev/null; then
      printf "%-20s %-10s %s\n" "Tool" "Calls" "Errors"
      printf "%-20s %-10s %s\n" "----" "-----" "------"

      cat "$session_dir"/*.jsonl 2>/dev/null |
        jq -r 'select(.event == "tool_call" or .event == "tool_result") | .tool' 2>/dev/null |
        sort | uniq -c | sort -rn |
        while IFS=' ' read -r count tool; do
          # Count is doubled (call + result), halve for tool calls
          local calls=$(( count / 2 ))
          [[ $calls -eq 0 ]] && calls=$count
          local errors
          errors=$(grep -l "\"tool\":\"$tool\"" "$session_dir"/*.jsonl 2>/dev/null |
            xargs grep -c "\"status\":\"error\".*\"tool\":\"$tool\"" 2>/dev/null |
            awk -F: '{sum += $2} END {print sum+0}')
          printf "%-20s %-10s %s\n" "$tool" "$calls" "$errors"
        done
    else
      IO:alert "jq is required for tool aggregation"
      grep -oh '"tool":"[^"]*"' "$session_dir"/*.jsonl 2>/dev/null |
        sort | uniq -c | sort -rn
    fi
    ;;

  errors)
    IO:print "## Errors (all sessions)"
    IO:print ""

    local found_errors=0
    for log_file in $(ls -t "$session_dir"/*.jsonl 2>/dev/null); do
      [[ ! -f "$log_file" ]] && continue
      local error_lines
      error_lines=$(grep '"status":"error"' "$log_file" 2>/dev/null || true)
      [[ -z "$error_lines" ]] && continue

      local session_name
      session_name=$(basename "$log_file" .jsonl)
      IO:print "${txtBold}Session: ${session_name}${txtReset}"

      while IFS= read -r line; do
        ((found_errors++))
        if command -v jq &>/dev/null; then
          local ts tool error
          ts=$(echo "$line" | jq -r '.ts // ""' 2>/dev/null)
          tool=$(echo "$line" | jq -r '.tool // ""' 2>/dev/null)
          error=$(echo "$line" | jq -r '.error // "unknown"' 2>/dev/null)
          printf "  %s  %-10s %s\n" "$ts" "$tool" "${error:0:80}"
        else
          echo "  $line"
        fi
      done <<<"$error_lines"
      IO:print ""
    done

    [[ $found_errors -eq 0 ]] && IO:print "No errors found."
    ;;

  *)
    IO:die "Unknown list subcommand: $subcommand (use: sessions, tools, errors)"
    ;;
  esac
}

function do_stats() {
  local session_id="$1"
  local session_dir
  session_dir=$(get_session_dir)
  [[ ! -d "$session_dir" ]] && IO:print "No audit logs found." && return 0

  Os:require "jq"

  if [[ -n "$session_id" ]]; then
    # Per-session stats
    local log_file
    log_file=$(find_session_file "$session_id") || IO:die "Session not found: $session_id"

    IO:print "## Stats: $(basename "$log_file" .jsonl)"
    IO:print ""

    local entries tool_calls results errors
    entries=$(count_entries "$log_file")
    tool_calls=$(grep -c '"event":"tool_call"' "$log_file" 2>/dev/null || echo 0)
    results=$(grep -c '"event":"tool_result"' "$log_file" 2>/dev/null || echo 0)
    errors=$(grep -c '"status":"error"' "$log_file" 2>/dev/null || echo 0)

    local first_ts last_ts
    first_ts=$(head -1 "$log_file" | jq -r '.ts // "?"')
    last_ts=$(tail -1 "$log_file" | jq -r '.ts // "?"')

    IO:print "Entries     : $entries"
    IO:print "Tool calls  : $tool_calls"
    IO:print "Results     : $results"
    IO:print "Errors      : $errors"
    IO:print "Error rate  : $(awk "BEGIN {if ($tool_calls>0) printf \"%.1f%%\", ($errors/$tool_calls)*100; else print \"0%\"}")"
    IO:print "First entry : $first_ts"
    IO:print "Last entry  : $last_ts"
    IO:print ""

    IO:print "### Tool breakdown"
    printf "%-20s %s\n" "Tool" "Calls"
    printf "%-20s %s\n" "----" "-----"
    grep '"event":"tool_call"' "$log_file" 2>/dev/null |
      jq -r '.tool' 2>/dev/null |
      sort | uniq -c | sort -rn |
      while IFS=' ' read -r count tool; do
        printf "%-20s %s\n" "${tool:-?}" "$count"
      done
  else
    # Global stats
    IO:print "## Global Stats"
    IO:print ""

    local sessions entries tool_calls errors
    sessions=$(count_sessions)
    entries=$(total_entries)
    tool_calls=$(cat "$session_dir"/*.jsonl 2>/dev/null | grep -c '"event":"tool_call"' 2>/dev/null || echo 0)
    errors=$(cat "$session_dir"/*.jsonl 2>/dev/null | grep -c '"status":"error"' 2>/dev/null || echo 0)

    IO:print "Sessions    : $sessions"
    IO:print "Total entries: $entries"
    IO:print "Tool calls  : $tool_calls"
    IO:print "Errors      : $errors"
    IO:print "Error rate  : $(awk "BEGIN {if ($tool_calls>0) printf \"%.1f%%\", ($errors/$tool_calls)*100; else print \"0%\"}")"
    IO:print "Disk size   : $(dir_size)"
    IO:print ""

    if [[ "$tool_calls" -gt 0 ]]; then
      IO:print "### Top tools (all sessions)"
      printf "%-20s %s\n" "Tool" "Calls"
      printf "%-20s %s\n" "----" "-----"
      cat "$session_dir"/*.jsonl 2>/dev/null |
        grep '"event":"tool_call"' |
        jq -r '.tool' 2>/dev/null |
        sort | uniq -c | sort -rn | head -10 |
        while read -r count tool; do
          printf "%-20s %s\n" "${tool:-?}" "$count"
        done
    fi
  fi
}

function do_export() {
  local session_id="$1"
  local session_dir
  session_dir=$(get_session_dir)
  [[ ! -d "$session_dir" ]] && IO:die "No audit logs found."

  local files=()
  if [[ -n "$session_id" ]]; then
    local log_file
    log_file=$(find_session_file "$session_id") || IO:die "Session not found: $session_id"
    files=("$log_file")
  else
    while IFS= read -r f; do
      files+=("$f")
    done < <(find "$session_dir" -name "*.jsonl" -type f 2>/dev/null | sort)
  fi

  [[ ${#files[@]} -eq 0 ]] && IO:die "No log files to export."

  case "${FORMAT,,}" in
  json)
    for f in "${files[@]}"; do
      cat "$f"
    done
    ;;

  csv)
    echo "timestamp,event,session,tool,status,input_summary,output_lines,error,seq"
    for f in "${files[@]}"; do
      if command -v jq &>/dev/null; then
        jq -r '[.ts, .event, .session, .tool, .status, .input_summary, .output_lines, .error, .seq] | map(. // "") | @csv' "$f" 2>/dev/null
      else
        IO:alert "jq required for CSV export; falling back to raw JSON"
        cat "$f"
      fi
    done
    ;;

  text)
    for f in "${files[@]}"; do
      local session_name
      session_name=$(basename "$f" .jsonl)
      IO:print "=== Session: $session_name ==="
      if command -v jq &>/dev/null; then
        jq -r '
          if .event == "session_start" then "[\(.ts)] SESSION START"
          elif .event == "session_end" then "[\(.ts)] SESSION END (tools: \(.tool_calls // 0), errors: \(.errors // 0))"
          elif .event == "tool_call" then "[\(.ts)] CALL \(.tool) — \(.input_summary // "")"
          elif .event == "tool_result" and .status == "error" then "[\(.ts)] ERROR \(.tool) — \(.error // "unknown")"
          elif .event == "tool_result" then "[\(.ts)] OK   \(.tool) (\(.output_lines // 0) lines)"
          else "[\(.ts)] \(.event)"
          end' "$f" 2>/dev/null
      else
        cat "$f"
      fi
      IO:print ""
    done
    ;;

  *)
    IO:die "Unknown format: $FORMAT (use: json, csv, text)"
    ;;
  esac
}

function do_tail() {
  local session_id="$1"
  local session_dir
  session_dir=$(get_session_dir)
  [[ ! -d "$session_dir" ]] && IO:print "No audit logs found." && return 0

  local log_file
  if [[ -n "$session_id" ]]; then
    log_file=$(find_session_file "$session_id") || IO:die "Session not found: $session_id"
  else
    # Most recently modified file
    log_file=$(ls -t "$session_dir"/*.jsonl 2>/dev/null | head -1)
    [[ -z "$log_file" ]] && IO:print "No audit logs found." && return 0
  fi

  local session_name
  session_name=$(basename "$log_file" .jsonl)
  IO:print "## Tail: $session_name (last $LINES entries)"
  IO:print ""

  if command -v jq &>/dev/null; then
    tail -n "$LINES" "$log_file" |
      jq -r '
        if .event == "session_start" then "[\(.ts)] SESSION START"
        elif .event == "session_end" then "[\(.ts)] SESSION END (tools: \(.tool_calls // 0), errors: \(.errors // 0))"
        elif .event == "tool_call" then "[\(.ts)] CALL \(.tool) — \(.input_summary // "")"
        elif .event == "tool_result" and .status == "error" then "[\(.ts)] ERROR \(.tool) — \(.error // "unknown")"
        elif .event == "tool_result" then "[\(.ts)] OK   \(.tool) (\(.output_lines // 0) lines)"
        else "[\(.ts)] \(.event)"
        end' 2>/dev/null
  else
    tail -n "$LINES" "$log_file"
  fi
}

function do_clean() {
  local session_dir
  session_dir=$(get_session_dir)
  [[ ! -d "$session_dir" ]] && IO:print "No audit logs to clean." && return 0

  local old_files
  old_files=$(find "$session_dir" -name "*.jsonl" -type f -mtime "+$DAYS" 2>/dev/null)
  local count
  count=$(echo "$old_files" | grep -c '.' 2>/dev/null || echo 0)

  if [[ "$count" -eq 0 || -z "$old_files" ]]; then
    IO:print "No log files older than $DAYS days."
    return 0
  fi

  IO:print "Found $count log file(s) older than $DAYS days."

  if ! ((FORCE)); then
    IO:confirm "Delete $count file(s)?" || return 1
  fi

  echo "$old_files" | while IFS= read -r f; do
    [[ -f "$f" ]] && rm -f "$f" && IO:debug "Deleted: $f"
  done

  IO:success "Cleaned $count log file(s)."
}

function do_install() {
  Os:require "jq"

  local settings_file
  settings_file=$(get_settings_file)
  local hooks_dir="$script_install_folder/hooks"

  # Make hook scripts executable
  chmod +x "$hooks_dir/on-tool-use.sh" 2>/dev/null || true
  chmod +x "$hooks_dir/on-session.sh" 2>/dev/null || true

  # Build the hooks JSON to merge
  local hooks_json
  hooks_json=$(jq -nc '{
    "PreToolUse": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-tool-use.sh pre"}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-tool-use.sh post"}]}],
    "PostToolUseFailure": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-tool-use.sh failure"}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-session.sh start"}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-session.sh end"}]}]
  }')

  if [[ -f "$settings_file" ]]; then
    # Check if hooks already installed
    if hooks_installed; then
      IO:alert "Audit log hooks are already installed."
      return 0
    fi

    # Deep-merge hooks into existing settings
    local tmp_file
    tmp_file=$(mktemp)
    jq --argjson new_hooks "$hooks_json" '
      .hooks //= {} |
      .hooks as $existing |
      .hooks = ($existing | to_entries | map(
        .key as $k |
        if ($new_hooks | has($k)) then
          .value += $new_hooks[$k]
        else
          .
        end
      ) | from_entries) + ($new_hooks | to_entries | map(select(.key as $k | $existing | has($k) | not)) | from_entries | {hooks: .} | .hooks) |
      .hooks = ($existing // {} ) * $new_hooks
    ' "$settings_file" >"$tmp_file" 2>/dev/null

    # Simpler approach: just combine the hooks arrays
    jq --argjson new_hooks "$hooks_json" '
      .hooks //= {} |
      .hooks |= (. as $existing |
        ($new_hooks | keys[]) as $event |
        if $existing[$event] then
          .[$event] += $new_hooks[$event]
        else
          .[$event] = $new_hooks[$event]
        end
      )
    ' "$settings_file" >"$tmp_file" 2>/dev/null

    if [[ -s "$tmp_file" ]]; then
      mv "$tmp_file" "$settings_file"
      IO:success "Hooks installed in $settings_file"
    else
      rm -f "$tmp_file"
      IO:die "Failed to merge hooks into settings file"
    fi
  else
    # Create new settings file with just hooks
    jq -nc --argjson hooks "$hooks_json" '{hooks: $hooks}' >"$settings_file"
    IO:success "Created $settings_file with audit log hooks"
  fi

  # Create log directory
  mkdir -p "$LOG_DIR"
  IO:success "Log directory ready: $LOG_DIR"
}

function do_uninstall() {
  Os:require "jq"

  local settings_file
  settings_file=$(get_settings_file)

  if [[ ! -f "$settings_file" ]]; then
    IO:print "No settings file found — nothing to uninstall."
    return 0
  fi

  if ! hooks_installed; then
    IO:print "Audit log hooks are not installed."
    return 0
  fi

  if ! ((FORCE)); then
    IO:confirm "Remove audit log hooks from settings?" || return 1
  fi

  # Remove hook entries that reference auditlog
  local tmp_file
  tmp_file=$(mktemp)
  jq '
    .hooks //= {} |
    .hooks |= with_entries(
      .value |= map(
        select(
          (.hooks // []) | all(.command // "" | test("auditlog") | not)
        )
      ) |
      .value |= if length == 0 then empty else . end
    ) |
    if .hooks == {} then del(.hooks) else . end
  ' "$settings_file" >"$tmp_file" 2>/dev/null

  if [[ -s "$tmp_file" ]]; then
    mv "$tmp_file" "$settings_file"
    IO:success "Audit log hooks removed from $settings_file"
  else
    rm -f "$tmp_file"
    IO:die "Failed to update settings file"
  fi
}

function do_check() {
  IO:print "## Audit Log Health Check"
  IO:print ""

  local all_ok=1

  # Check jq
  if command -v jq &>/dev/null; then
    IO:success "jq is installed ($(jq --version 2>/dev/null || echo '?'))"
  else
    IO:alert "jq is NOT installed — hooks will use fallback mode, CLI features limited"
    all_ok=0
  fi

  # Check hook scripts
  local hooks_dir="$script_install_folder/hooks"
  for hook_script in on-tool-use.sh on-session.sh; do
    if [[ -x "$hooks_dir/$hook_script" ]]; then
      IO:success "Hook script: $hook_script (executable)"
    elif [[ -f "$hooks_dir/$hook_script" ]]; then
      IO:alert "Hook script: $hook_script (exists but NOT executable)"
      all_ok=0
    else
      IO:alert "Hook script: $hook_script (MISSING)"
      all_ok=0
    fi
  done

  # Check hook registration
  if hooks_installed; then
    IO:success "Hooks are registered in settings"
  else
    IO:alert "Hooks are NOT registered (run: $script_basename install)"
    all_ok=0
  fi

  # Check log directory
  local session_dir
  session_dir=$(get_session_dir)
  if [[ -d "$session_dir" ]]; then
    if [[ -w "$session_dir" ]]; then
      IO:success "Log directory: $session_dir (writable)"
    else
      IO:alert "Log directory: $session_dir (NOT writable)"
      all_ok=0
    fi
  else
    IO:alert "Log directory: $session_dir (does not exist — will be created on first hook)"
    # Not a failure, it'll be created
  fi

  IO:print ""
  if [[ $all_ok -eq 1 ]]; then
    IO:success "All checks passed"
  else
    IO:alert "Some checks failed — see above"
  fi
}

#####################################################################
################### DO NOT MODIFY BELOW THIS LINE ###################
#####################################################################
action=""
error_prefix=""
git_repo_remote=""
git_repo_root=""
install_package=""
os_kernel=""
os_machine=""
os_name=""
os_version=""
script_basename=""
script_hash="?"
script_lines="?"
script_prefix=""
shell_brand=""
shell_version=""
temp_files=()

# set strict mode -  via http://redsymbol.net/articles/unofficial-bash-strict-mode/
# removed -e because it made basic [[ testing ]] difficult
set -uo pipefail
IFS=$'\n\t'
FORCE=0
help=0

#to enable VERBOSE even before option parsing
VERBOSE=0
[[ $# -gt 0 ]] && [[ $1 == "-v" ]] && VERBOSE=1

#to enable QUIET even before option parsing
QUIET=0
[[ $# -gt 0 ]] && [[ $1 == "-q" ]] && QUIET=1

txtReset=""
txtError=""
txtInfo=""
txtInfo=""
txtWarn=""
txtBold=""
txtItalic=""
txtUnderline=""

char_succes="OK "
char_fail="!! "
char_alert="?? "
char_wait="..."
info_icon="(i)"
config_icon="[c]"
clean_icon="[c]"
require_icon="[r]"

### stdIO:print/stderr output
function IO:initialize() {
  script_started_at="$(Tool:time)"
  IO:debug "script $script_basename started at $script_started_at"

  [[ "${BASH_SOURCE[0]:-}" != "${0}" ]] && sourced=1 || sourced=0
  [[ -t 1 ]] && piped=0 || piped=1 # detect if output is piped
  if [[ $piped -eq 0 && -n "$TERM" ]]; then
    txtReset=$(tput sgr0)
    txtError=$(tput setaf 160)
    txtInfo=$(tput setaf 2)
    txtWarn=$(tput setaf 214)
    txtBold=$(tput bold)
    txtItalic=$(tput sitm)
    txtUnderline=$(tput smul)
  fi

  [[ $(echo -e '\xe2\x82\xac') == '€' ]] && unicode=1 || unicode=0 # detect if unicode is supported
  if [[ $unicode -gt 0 ]]; then
    char_succes="✅"
    char_fail="⛔"
    char_alert="✴️"
    char_wait="⏳"
    info_icon="🌼"
    config_icon="🌱"
    clean_icon="🧽"
    require_icon="🔌"
  fi
  error_prefix="${txtError}>${txtReset}"
}

function IO:print() {
  ((QUIET)) && true || printf '%b\n' "$*"
}

function IO:debug() {
  ((VERBOSE)) && IO:print "${txtInfo}# $* ${txtReset}" >&2
  true
}

function IO:die() {
  IO:print "${txtError}${char_fail} $script_basename${txtReset}: $*" >&2
  Os:beep
  Script:exit
}

function IO:alert() {
  IO:print "${txtWarn}${char_alert}${txtReset}: ${txtUnderline}$*${txtReset}" >&2
}

function IO:success() {
  IO:print "${txtInfo}${char_succes}${txtReset}  ${txtBold}$*${txtReset}"
}

function IO:announce() {
  IO:print "${txtInfo}${char_wait}${txtReset}  ${txtItalic}$*${txtReset}"
  sleep 1
}

function IO:progress() {
  ((QUIET)) || (
    local screen_width
    screen_width=$(tput cols 2>/dev/null || echo 80)
    local rest_of_line
    rest_of_line=$((screen_width - 5))

    if ((piped)); then
      IO:print "... $*" >&2
    else
      printf "... %-${rest_of_line}b\r" "$*                                             " >&2
    fi
  )
}

function IO:countdown() {
  local seconds=${1:-5}
  local message=${2:-Countdown :}
  local i

  if ((piped)); then
    IO:print "$message $seconds seconds"
  else
    for ((i = 0; i < "$seconds"; i++)); do
      IO:progress "${txtInfo}$message $((seconds - i)) seconds${txtReset}"
      sleep 1
    done
    IO:print "                         "
  fi
}

### interactive
function IO:confirm() {
  ((FORCE)) && return 0
  read -r -p "$1 [y/N] " -n 1
  echo " "
  [[ $REPLY =~ ^[Yy]$ ]]
}

function IO:question() {
  local ANSWER
  local DEFAULT=${2:-}
  read -r -p "$1 ($DEFAULT) > " ANSWER
  [[ -z "$ANSWER" ]] && echo "$DEFAULT" || echo "$ANSWER"
}

function IO:log() {
  [[ -n "${log_file:-}" ]] && echo "$(date '+%H:%M:%S') | $*" >>"$log_file"
}

function Tool:calc() {
  awk "BEGIN {print $*} ; "
}

function Tool:round() {
  local number="${1}"
  local decimals="${2:-0}"

  awk "BEGIN {print sprintf( \"%.${decimals}f\" , $number )};"
}

function Tool:time() {
  if [[ $(command -v perl) ]]; then
    perl -MTime::HiRes=time -e 'printf "%f\n", time'
  elif [[ $(command -v php) ]]; then
    php -r 'printf("%f\n",microtime(true));'
  elif [[ $(command -v python) ]]; then
    python -c 'import time; print(time.time()) '
  elif [[ $(command -v python3) ]]; then
    python3 -c 'import time; print(time.time()) '
  elif [[ $(command -v node) ]]; then
    node -e 'console.log(+new Date() / 1000)'
  elif [[ $(command -v ruby) ]]; then
    ruby -e 'STDOUT.puts(Time.now.to_f)'
  else
    date '+%s.000'
  fi
}

function Tool:throughput() {
  local time_started="$1"
  [[ -z "$time_started" ]] && time_started="$script_started_at"
  local operations="${2:-1}"
  local name="${3:-operation}"

  local time_finished
  local duration
  local seconds
  time_finished="$(Tool:time)"
  duration="$(Tool:calc "$time_finished - $time_started")"
  seconds="$(Tool:round "$duration")"
  local ops
  if [[ "$operations" -gt 1 ]]; then
    if [[ $operations -gt $seconds ]]; then
      ops=$(Tool:calc "$operations / $duration")
      ops=$(Tool:round "$ops" 3)
      duration=$(Tool:round "$duration" 2)
      IO:print "$operations $name finished in $duration secs: $ops $name/sec"
    else
      ops=$(Tool:calc "$duration / $operations")
      ops=$(Tool:round "$ops" 3)
      duration=$(Tool:round "$duration" 2)
      IO:print "$operations $name finished in $duration secs: $ops sec/$name"
    fi
  else
    duration=$(Tool:round "$duration" 2)
    IO:print "$name finished in $duration secs"
  fi
}

### string processing

function Str:trim() {
  local var="$*"
  # remove leading whitespace characters
  var="${var#"${var%%[![:space:]]*}"}"
  # remove trailing whitespace characters
  var="${var%"${var##*[![:space:]]}"}"
  printf '%s' "$var"
}

function Str:lower() {
  if [[ -n "$1" ]]; then
    local input="$*"
    echo "${input,,}"
  else
    awk '{print tolower($0)}'
  fi
}

function Str:upper() {
  if [[ -n "$1" ]]; then
    local input="$*"
    echo "${input^^}"
  else
    awk '{print toupper($0)}'
  fi
}

function Str:ascii() {
  # remove all characters with accents/diacritics to latin alphabet
  # shellcheck disable=SC2020
  sed 'y/àáâäæãåāǎçćčèéêëēėęěîïííīįìǐłñńôöòóœøōǒõßśšûüǔùǖǘǚǜúūÿžźżÀÁÂÄÆÃÅĀǍÇĆČÈÉÊËĒĖĘĚÎÏÍÍĪĮÌǏŁÑŃÔÖÒÓŒØŌǑÕẞŚŠÛÜǓÙǕǗǙǛÚŪŸŽŹŻ/aaaaaaaaaccceeeeeeeeiiiiiiiilnnooooooooosssuuuuuuuuuuyzzzAAAAAAAAACCCEEEEEEEEIIIIIIIILNNOOOOOOOOOSSSUUUUUUUUUUYZZZ/'
}

function Str:slugify() {
  # Str:slugify <input> <separator>
  # Str:slugify "Jack, Jill & Clémence LTD"      => jack-jill-clemence-ltd
  # Str:slugify "Jack, Jill & Clémence LTD" "_"  => jack_jill_clemence_ltd
  separator="${2:-}"
  [[ -z "$separator" ]] && separator="-"
  Str:lower "$1" |
    Str:ascii |
    awk '{
          gsub(/[\[\]@#$%^&*;,.:()<>!?\/+=_]/," ",$0);
          gsub(/^  */,"",$0);
          gsub(/  *$/,"",$0);
          gsub(/  */,"-",$0);
          gsub(/[^a-z0-9\-]/,"");
          print;
          }' |
    sed "s/-/$separator/g"
}

function Str:title() {
  # Str:title <input> <separator>
  # Str:title "Jack, Jill & Clémence LTD"     => JackJillClemenceLtd
  # Str:title "Jack, Jill & Clémence LTD" "_" => Jack_Jill_Clemence_Ltd
  separator="${2:-}"
  # shellcheck disable=SC2020
  Str:lower "$1" |
    tr 'àáâäæãåāçćčèéêëēėęîïííīįìłñńôöòóœøōõßśšûüùúūÿžźż' 'aaaaaaaaccceeeeeeeiiiiiiilnnoooooooosssuuuuuyzzz' |
    awk '{ gsub(/[\[\]@#$%^&*;,.:()<>!?\/+=_-]/," ",$0); print $0; }' |
    awk '{
          for (i=1; i<=NF; ++i) {
              $i = toupper(substr($i,1,1)) tolower(substr($i,2))
          };
          print $0;
          }' |
    sed "s/ /$separator/g" |
    cut -c1-50
}

function Str:digest() {
  local length=${1:-6}
  if [[ -n $(command -v md5sum) ]]; then
    # regular linux
    md5sum | cut -c1-"$length"
  else
    # macos
    md5 | cut -c1-"$length"
  fi
}

# Gha: function should only be run inside of a Github Action

function Gha:finish() {
  [[ -z "${RUNNER_OS:-}" ]] && IO:die "This should only run inside a Github Action, don't run it on your machine"
  local timestamp message
  git config user.name "Bashew Runner"
  git config user.email "actions@users.noreply.github.com"
  git add -A
  timestamp="$(date -u)"
  message="$timestamp < $script_basename $script_version"
  IO:print "Commit Message: $message"
  git commit -m "${message}" || exit 0
  git pull --rebase
  git push
  IO:success "Commit OK!"
}

trap "IO:die \"ERROR \$? after \$SECONDS seconds \n\
\${error_prefix} last command : '\$BASH_COMMAND' \" \
\$(< \$script_install_path awk -v lineno=\$LINENO \
'NR == lineno {print \"\${error_prefix} from line \" lineno \" : \" \$0}')" INT TERM EXIT
# cf https://askubuntu.com/questions/513932/what-is-the-bash-command-variable-good-for

Script:exit() {
  local temp_file
  for temp_file in "${temp_files[@]-}"; do
    [[ -f "$temp_file" ]] && (
      IO:debug "Delete temp file [$temp_file]"
      rm -f "$temp_file"
    )
  done
  trap - INT TERM EXIT
  IO:debug "$script_basename finished after $SECONDS seconds"
  exit 0
}

Script:check_version() {
  (
    # shellcheck disable=SC2164
    pushd "$script_install_folder" &>/dev/null
    if [[ -d .git ]]; then
      local remote
      remote="$(git remote -v | grep fetch | awk 'NR == 1 {print $2}')"
      IO:progress "Check for updates - $remote"
      git remote update &>/dev/null
      if [[ $(git rev-list --count "HEAD...HEAD@{upstream}" 2>/dev/null) -gt 0 ]]; then
        IO:print "There is a more recent update of this script - run <<$script_prefix update>> to update"
      else
        IO:progress "                                         "
      fi
    fi
    # shellcheck disable=SC2164
    popd &>/dev/null
  )
}

Script:git_pull() {
  # run in background to avoid problems with modifying a running interpreted script
  (
    sleep 1
    cd "$script_install_folder" && git pull
  ) &
}

Script:show_tips() {
  ((sourced)) && return 0
  # shellcheck disable=SC2016
  grep <"${BASH_SOURCE[0]}" -v '$0' |
    awk \
      -v green="$txtInfo" \
      -v yellow="$txtWarn" \
      -v reset="$txtReset" \
      '
      /TIP: /  {$1=""; gsub(/«/,green); gsub(/»/,reset); print "*" $0}
      /TIP:> / {$1=""; print " " yellow $0 reset}
      ' |
    awk \
      -v script_basename="$script_basename" \
      -v script_prefix="$script_prefix" \
      '{
      gsub(/\$script_basename/,script_basename);
      gsub(/\$script_prefix/,script_prefix);
      print ;
      }'
}

Script:check() {
  local name
  if [[ -n $(Option:filter flag) ]]; then
    IO:print "## ${txtInfo}boolean flags${txtReset}:"
    Option:filter flag |
      grep -v help |
      while read -r name; do
        declare -p "$name" | cut -d' ' -f3-
      done
  fi

  if [[ -n $(Option:filter option) ]]; then
    IO:print "## ${txtInfo}option defaults${txtReset}:"
    Option:filter option |
      while read -r name; do
        declare -p "$name" | cut -d' ' -f3-
      done
  fi

  if [[ -n $(Option:filter list) ]]; then
    IO:print "## ${txtInfo}list options${txtReset}:"
    Option:filter list |
      while read -r name; do
        declare -p "$name" | cut -d' ' -f3-
      done
  fi

  if [[ -n $(Option:filter param) ]]; then
    if ((piped)); then
      IO:debug "Skip parameters for .env files"
    else
      IO:print "## ${txtInfo}parameters${txtReset}:"
      Option:filter param |
        while read -r name; do
          declare -p "$name" | cut -d' ' -f3-
        done
    fi
  fi

  if [[ -n $(Option:filter choice) ]]; then
    if ((piped)); then
      IO:debug "Skip choices for .env files"
    else
      IO:print "## ${txtInfo}choice${txtReset}:"
      Option:filter choice |
        while read -r name; do
          declare -p "$name" | cut -d' ' -f3-
        done
    fi
  fi

  IO:print "## ${txtInfo}required commands${txtReset}:"
  Script:show_required
}

Option:usage() {
  IO:print "Program : ${txtInfo}$script_basename${txtReset}  by ${txtWarn}$script_author${txtReset}"
  IO:print "Version : ${txtInfo}v$script_version${txtReset} (${txtWarn}$script_modified${txtReset})"
  IO:print "Purpose : ${txtInfo}$script_description${txtReset}"
  echo -n "Usage   : $script_basename"
  Option:config |
    awk '
  BEGIN { FS="|"; OFS=" "; oneline="" ; fulltext="Flags, options and parameters:"}
  $1 ~ /flag/  {
    fulltext = fulltext sprintf("\n    -%1s|--%-12s: [flag] %s [default: off]",$2,$3,$4) ;
    oneline  = oneline " [-" $2 "]"
    }
  $1 ~ /option/  {
    fulltext = fulltext sprintf("\n    -%1s|--%-12s: [option] %s",$2,$3 " <?>",$4) ;
    if($5!=""){fulltext = fulltext "  [default: " $5 "]"; }
    oneline  = oneline " [-" $2 " <" $3 ">]"
    }
  $1 ~ /list/  {
    fulltext = fulltext sprintf("\n    -%1s|--%-12s: [list] %s (array)",$2,$3 " <?>",$4) ;
    fulltext = fulltext "  [default empty]";
    oneline  = oneline " [-" $2 " <" $3 ">]"
    }
  $1 ~ /secret/  {
    fulltext = fulltext sprintf("\n    -%1s|--%s <%s>: [secret] %s",$2,$3,"?",$4) ;
      oneline  = oneline " [-" $2 " <" $3 ">]"
    }
  $1 ~ /param/ {
    if($2 == "1"){
          fulltext = fulltext sprintf("\n    %-17s: [parameter] %s","<"$3">",$4);
          oneline  = oneline " <" $3 ">"
     }
     if($2 == "?"){
          fulltext = fulltext sprintf("\n    %-17s: [parameter] %s (optional)","<"$3">",$4);
          oneline  = oneline " <" $3 "?>"
     }
     if($2 == "n"){
          fulltext = fulltext sprintf("\n    %-17s: [parameters] %s (1 or more)","<"$3">",$4);
          oneline  = oneline " <" $3 " …>"
     }
    }
  $1 ~ /choice/ {
        fulltext = fulltext sprintf("\n    %-17s: [choice] %s","<"$3">",$4);
        if($5!=""){fulltext = fulltext "  [options: " $5 "]"; }
        oneline  = oneline " <" $3 ">"
    }
    END {print oneline; print fulltext}
  '
}

function Option:filter() {
  Option:config | grep "$1|" | cut -d'|' -f3 | sort | grep -v '^\s*$'
}

function Script:show_required() {
  grep 'Os:require' "$script_install_path" |
    grep -v -E '\(\)|grep|# Os:require' |
    awk -v install="# $install_package " '
    function ltrim(s) { sub(/^[ "\t\r\n]+/, "", s); return s }
    function rtrim(s) { sub(/[ "\t\r\n]+$/, "", s); return s }
    function trim(s) { return rtrim(ltrim(s)); }
    NF == 2 {print install trim($2); }
    NF == 3 {print install trim($3); }
    NF > 3  {$1=""; $2=""; $0=trim($0); print "# " trim($0);}
  ' |
    sort -u
}

function Option:initialize() {
  local init_command
  init_command=$(Option:config |
    grep -v "VERBOSE|" |
    awk '
    BEGIN { FS="|"; OFS=" ";}
    $1 ~ /flag/   && $5 == "" {print $3 "=0; "}
    $1 ~ /flag/   && $5 != "" {print $3 "=\"" $5 "\"; "}
    $1 ~ /option/ && $5 == "" {print $3 "=\"\"; "}
    $1 ~ /option/ && $5 != "" {print $3 "=\"" $5 "\"; "}
    $1 ~ /choice/   {print $3 "=\"\"; "}
    $1 ~ /list/     {print $3 "=(); "}
    $1 ~ /secret/   {print $3 "=\"\"; "}
    ')
  if [[ -n "$init_command" ]]; then
    eval "$init_command"
  fi
}

function Option:has_single() { Option:config | grep 'param|1|' >/dev/null; }
function Option:has_choice() { Option:config | grep 'choice|1' >/dev/null; }
function Option:has_optional() { Option:config | grep 'param|?|' >/dev/null; }
function Option:has_multi() { Option:config | grep 'param|n|' >/dev/null; }

function Option:parse() {
  if [[ $# -eq 0 ]]; then
    Option:usage >&2
    Script:exit
  fi

  ## first process all the -x --xxxx flags and options
  while true; do
    # flag <flag> is saved as $flag = 0/1
    # option <option> is saved as $option
    if [[ $# -eq 0 ]]; then
      ## all parameters processed
      break
    fi
    if [[ ! $1 == -?* ]]; then
      ## all flags/options processed
      break
    fi
    local save_option
    save_option=$(Option:config |
      awk -v opt="$1" '
        BEGIN { FS="|"; OFS=" ";}
        $1 ~ /flag/   &&  "-"$2 == opt {print $3"=1"}
        $1 ~ /flag/   && "--"$3 == opt {print $3"=1"}
        $1 ~ /option/ &&  "-"$2 == opt {print $3"=${2:-}; shift"}
        $1 ~ /option/ && "--"$3 == opt {print $3"=${2:-}; shift"}
        $1 ~ /list/ &&  "-"$2 == opt {print $3"+=(${2:-}); shift"}
        $1 ~ /list/ && "--"$3 == opt {print $3"=(${2:-}); shift"}
        $1 ~ /secret/ &&  "-"$2 == opt {print $3"=${2:-}; shift #noshow"}
        $1 ~ /secret/ && "--"$3 == opt {print $3"=${2:-}; shift #noshow"}
        ')
    if [[ -n "$save_option" ]]; then
      if echo "$save_option" | grep shift >>/dev/null; then
        local save_var
        save_var=$(echo "$save_option" | cut -d= -f1)
        IO:debug "$config_icon parameter: ${save_var}=$2"
      else
        IO:debug "$config_icon flag: $save_option"
      fi
      eval "$save_option"
    else
      IO:die "cannot interpret option [$1]"
    fi
    shift
  done

  ((help)) && (
    Option:usage
    Script:check_version
    IO:print "                                  "
    echo "### TIPS & EXAMPLES"
    Script:show_tips

  ) && Script:exit

  local option_list
  local option_count
  local choices
  local single_params
  ## then run through the given parameters
  if Option:has_choice; then
    choices=$(Option:config | awk -F"|" '
      $1 == "choice" && $2 == 1 {print $3}
      ')
    option_list=$(xargs <<<"$choices")
    option_count=$(wc <<<"$choices" -w | xargs)
    IO:debug "$config_icon Expect : $option_count choice(s): $option_list"
    [[ $# -eq 0 ]] && IO:die "need the choice(s) [$option_list]"

    local choices_list
    local valid_choice
    local param
    for param in $choices; do
      [[ $# -eq 0 ]] && IO:die "need choice [$param]"
      [[ -z "$1" ]] && IO:die "need choice [$param]"
      IO:debug "$config_icon Assign : $param=$1"
      # check if choice is in list
      choices_list=$(Option:config | awk -F"|" -v choice="$param" '$1 == "choice" && $3 = choice {print $5}')
      valid_choice=$(tr <<<"$choices_list" "," "\n" | grep "$1")
      [[ -z "$valid_choice" ]] && IO:die "choice [$1] is not valid, should be in list [$choices_list]"

      eval "$param=\"$1\""
      shift
    done
  else
    IO:debug "$config_icon No choices to process"
    choices=""
    option_count=0
  fi

  if Option:has_single; then
    single_params=$(Option:config | awk -F"|" '
      $1 == "param" && $2 == 1 {print $3}
      ')
    option_list=$(xargs <<<"$single_params")
    option_count=$(wc <<<"$single_params" -w | xargs)
    IO:debug "$config_icon Expect : $option_count single parameter(s): $option_list"
    [[ $# -eq 0 ]] && IO:die "need the parameter(s) [$option_list]"

    for param in $single_params; do
      [[ $# -eq 0 ]] && IO:die "need parameter [$param]"
      [[ -z "$1" ]] && IO:die "need parameter [$param]"
      IO:debug "$config_icon Assign : $param=$1"
      eval "$param=\"$1\""
      shift
    done
  else
    IO:debug "$config_icon No single params to process"
    single_params=""
    option_count=0
  fi

  if Option:has_optional; then
    local optional_params
    local optional_count
    optional_params=$(Option:config | grep 'param|?|' | cut -d'|' -f3)
    optional_count=$(wc <<<"$optional_params" -w | xargs)
    IO:debug "$config_icon Expect : $optional_count optional parameter(s): $(echo "$optional_params" | xargs)"

    for param in $optional_params; do
      IO:debug "$config_icon Assign : $param=${1:-}"
      eval "$param=\"${1:-}\""
      shift
    done
  else
    IO:debug "$config_icon No optional params to process"
    optional_params=""
    optional_count=0
  fi

  if Option:has_multi; then
    #IO:debug "Process: multi param"
    local multi_count
    local multi_param
    multi_count=$(Option:config | grep -c 'param|n|')
    multi_param=$(Option:config | grep 'param|n|' | cut -d'|' -f3)
    IO:debug "$config_icon Expect : $multi_count multi parameter: $multi_param"
    ((multi_count > 1)) && IO:die "cannot have >1 'multi' parameter: [$multi_param]"
    ((multi_count > 0)) && [[ $# -eq 0 ]] && IO:die "need the (multi) parameter [$multi_param]"
    # save the rest of the params in the multi param
    if [[ -n "$*" ]]; then
      IO:debug "$config_icon Assign : $multi_param=$*"
      eval "$multi_param=( $* )"
    fi
  else
    multi_count=0
    multi_param=""
    [[ $# -gt 0 ]] && IO:die "cannot interpret extra parameters"
  fi
}

function Os:require() {
  local install_instructions
  local binary
  local words
  local path_binary
  # $1 = binary that is required
  binary="$1"
  path_binary=$(command -v "$binary" 2>/dev/null)
  [[ -n "$path_binary" ]] && IO:debug "️$require_icon required [$binary] -> $path_binary" && return 0
  # $2 = how to install it
  IO:alert "$script_basename needs [$binary] but it cannot be found"
  words=$(echo "${2:-}" | wc -w)
  install_instructions="$install_package $1"
  [[ $words -eq 1 ]] && install_instructions="$install_package $2"
  [[ $words -gt 1 ]] && install_instructions="${2:-}"
  if ((FORCE)); then
    IO:announce "Installing [$1] ..."
    eval "$install_instructions"
  else
    IO:alert "1) install package  : $install_instructions"
    IO:alert "2) check path       : export PATH=\"[path of your binary]:\$PATH\""
    IO:die "Missing program/script [$binary]"
  fi
}

function Os:folder() {
  if [[ -n "$1" ]]; then
    local folder="$1"
    local max_days=${2:-365}
    if [[ ! -d "$folder" ]]; then
      IO:debug "$clean_icon Create folder : [$folder]"
      mkdir -p "$folder"
    else
      IO:debug "$clean_icon Cleanup folder: [$folder] - delete files older than $max_days day(s)"
      find "$folder" -mtime "+$max_days" -type f -exec rm {} \;
    fi
  fi
}

function Os:follow_link() {
  [[ ! -L "$1" ]] && echo "$1" && return 0 ## if it's not a symbolic link, return immediately
  local file_folder link_folder link_name symlink
  file_folder="$(dirname "$1")"
  [[ "$file_folder" != /* ]] && file_folder="$(cd -P "$file_folder" &>/dev/null && pwd)"
  symlink=$(readlink "$1")
  link_folder=$(dirname "$symlink")
  [[ -z "$link_folder" ]] && link_folder="$file_folder"
  [[ "$link_folder" == \.* ]] && link_folder="$(cd -P "$file_folder" && cd -P "$link_folder" &>/dev/null && pwd)"
  link_name=$(basename "$symlink")
  IO:debug "$info_icon Symbolic ln: $1 -> [$link_folder/$link_name]"
  Os:follow_link "$link_folder/$link_name" ## recurse
}

function Os:notify() {
  local message="$1"
  local source="${2:-$script_basename}"

  [[ -n $(command -v notify-send) ]] && notify-send "$source" "$message"                                      # for Linux
  [[ -n $(command -v osascript) ]] && osascript -e "display notification \"$message\" with title \"$source\"" # for MacOS
}

function Os:busy() {
  # show spinner as long as process $pid is running
  local pid="$1"
  local message="${2:-}"
  local frames=("|" "/" "-" "\\")
  (
    while kill -0 "$pid" &>/dev/null; do
      for frame in "${frames[@]}"; do
        printf "\r[ $frame ] %s..." "$message"
        sleep 0.5
      done
    done
    printf "\n"
  )
}

function Os:beep() {
  if [[ -n "$TERM" ]]; then
    tput bel
  fi
}

function Script:meta() {

  script_prefix=$(basename "${BASH_SOURCE[0]}" .sh)
  script_basename=$(basename "${BASH_SOURCE[0]}")
  execution_day=$(date "+%Y-%m-%d")

  script_install_path="${BASH_SOURCE[0]}"
  IO:debug "$info_icon Script path: $script_install_path"
  script_install_path=$(Os:follow_link "$script_install_path")
  IO:debug "$info_icon Linked path: $script_install_path"
  script_install_folder="$(cd -P "$(dirname "$script_install_path")" && pwd)"
  IO:debug "$info_icon In folder  : $script_install_folder"
  if [[ -f "$script_install_path" ]]; then
    script_hash=$(Str:digest <"$script_install_path" 8)
    script_lines=$(awk <"$script_install_path" 'END {print NR}')
  fi

  # get shell/operating system/versions
  shell_brand="sh"
  shell_version="?"
  [[ -n "${ZSH_VERSION:-}" ]] && shell_brand="zsh" && shell_version="$ZSH_VERSION"
  [[ -n "${BASH_VERSION:-}" ]] && shell_brand="bash" && shell_version="$BASH_VERSION"
  [[ -n "${FISH_VERSION:-}" ]] && shell_brand="fish" && shell_version="$FISH_VERSION"
  [[ -n "${KSH_VERSION:-}" ]] && shell_brand="ksh" && shell_version="$KSH_VERSION"
  IO:debug "$info_icon Shell type : $shell_brand - version $shell_version"
  if [[ "$shell_brand" == "bash" && "${BASH_VERSINFO:-0}" -lt 4 ]]; then
    IO:die "Bash version 4 or higher is required - current version = ${BASH_VERSINFO:-0}"
  fi

  os_kernel=$(uname -s)
  os_version=$(uname -r)
  os_machine=$(uname -m)
  install_package=""
  case "$os_kernel" in
  CYGWIN* | MSYS* | MINGW*)
    os_name="Windows"
    ;;
  Darwin)
    os_name=$(sw_vers -productName)       # macOS
    os_version=$(sw_vers -productVersion) # 11.1
    install_package="brew install"
    ;;
  Linux | GNU*)
    if [[ $(command -v lsb_release) ]]; then
      os_name=$(lsb_release -i | awk -F: '{$1=""; gsub(/^[\s\t]+/,"",$2); gsub(/[\s\t]+$/,"",$2); print $2}')
      os_version=$(lsb_release -r | awk -F: '{$1=""; gsub(/^[\s\t]+/,"",$2); gsub(/[\s\t]+$/,"",$2); print $2}')
    else
      os_name="Linux"
    fi
    [[ -x /bin/apt-cyg ]] && install_package="apt-cyg install"     # Cygwin
    [[ -x /bin/dpkg ]] && install_package="dpkg -i"                # Synology
    [[ -x /opt/bin/ipkg ]] && install_package="ipkg install"       # Synology
    [[ -x /usr/sbin/pkg ]] && install_package="pkg install"        # BSD
    [[ -x /usr/bin/pacman ]] && install_package="pacman -S"        # Arch Linux
    [[ -x /usr/bin/zypper ]] && install_package="zypper install"   # Suse Linux
    [[ -x /usr/bin/emerge ]] && install_package="emerge"           # Gentoo
    [[ -x /usr/bin/yum ]] && install_package="yum install"         # RedHat RHEL/CentOS/Fedora
    [[ -x /usr/bin/apk ]] && install_package="apk add"             # Alpine
    [[ -x /usr/bin/apt-get ]] && install_package="apt-get install" # Debian
    [[ -x /usr/bin/apt ]] && install_package="apt install"         # Ubuntu
    ;;

  esac
  IO:debug "$info_icon System OS  : $os_name ($os_kernel) $os_version on $os_machine"
  IO:debug "$info_icon Package mgt: $install_package"

  # get last modified date of this script
  script_modified="??"
  [[ "$os_kernel" == "Linux" ]] && script_modified=$(stat -c %y "$script_install_path" 2>/dev/null | cut -c1-16) # generic linux
  [[ "$os_kernel" == "Darwin" ]] && script_modified=$(stat -f "%Sm" "$script_install_path" 2>/dev/null)          # for MacOS

  IO:debug "$info_icon Version  : $script_version"
  IO:debug "$info_icon Created  : $script_created"
  IO:debug "$info_icon Modified : $script_modified"

  IO:debug "$info_icon Lines    : $script_lines lines / md5: $script_hash"
  IO:debug "$info_icon User     : ${USER:-$(whoami)}@${HOSTNAME:-$(hostname 2>/dev/null || echo unknown)}"

  # if run inside a git repo, detect for which remote repo it is
  if git status &>/dev/null; then
    git_repo_remote=$(git remote -v | awk '/(fetch)/ {print $2}')
    IO:debug "$info_icon git remote : $git_repo_remote"
    git_repo_root=$(git rev-parse --show-toplevel)
    IO:debug "$info_icon git folder : $git_repo_root"
  fi

  # get script version from VERSION.md file - which is automatically updated by pforret/setver
  [[ -f "$script_install_folder/VERSION.md" ]] && script_version=$(cat "$script_install_folder/VERSION.md")
  # get script version from git tag file - which is automatically updated by pforret/setver
  [[ -n "$git_repo_root" ]] && [[ -n "$(git tag &>/dev/null)" ]] && script_version=$(git tag --sort=version:refname | tail -1)
}

function Script:initialize() {
  log_file=""
  if [[ -n "${TMP_DIR:-}" ]]; then
    # clean up TMP folder after 1 day
    Os:folder "$TMP_DIR" 1
  fi
  if [[ -n "${LOG_DIR:-}" ]]; then
    # clean up LOG folder after 1 month
    Os:folder "$LOG_DIR" 30
    log_file="$LOG_DIR/$script_prefix.$execution_day.log"
    IO:debug "$config_icon log_file: $log_file"
  fi
}

function Os:tempfile() {
  local extension=${1:-txt}
  local file="${TMP_DIR:-/tmp}/$execution_day.$RANDOM.$extension"
  IO:debug "$config_icon tmp_file: $file"
  temp_files+=("$file")
  echo "$file"
}

function Os:import_env() {
  local env_files
  if [[ $(pwd) == "$script_install_folder" ]]; then
    env_files=(
      "$script_install_folder/.env"
      "$script_install_folder/.$script_prefix.env"
      "$script_install_folder/$script_prefix.env"
    )
  else
    env_files=(
      "$script_install_folder/.env"
      "$script_install_folder/.$script_prefix.env"
      "$script_install_folder/$script_prefix.env"
      "./.env"
      "./.$script_prefix.env"
      "./$script_prefix.env"
    )
  fi

  local env_file
  for env_file in "${env_files[@]}"; do
    if [[ -f "$env_file" ]]; then
      IO:debug "$config_icon Read  dotenv: [$env_file]"
      local clean_file
      clean_file=$(Os:clean_env "$env_file")
      # shellcheck disable=SC1090
      source "$clean_file" && rm "$clean_file"
    fi
  done
}

function Os:clean_env() {
  local input="$1"
  local output="$1.__.sh"
  [[ ! -f "$input" ]] && IO:die "Input file [$input] does not exist"
  IO:debug "$clean_icon Clean dotenv: [$output]"
  awk <"$input" '
      function ltrim(s) { sub(/^[ \t\r\n]+/, "", s); return s }
      function rtrim(s) { sub(/[ \t\r\n]+$/, "", s); return s }
      function trim(s) { return rtrim(ltrim(s)); }
      /=/ { # skip lines with no equation
        $0=trim($0);
        if(substr($0,1,1) != "#"){ # skip comments
          equal=index($0, "=");
          key=trim(substr($0,1,equal-1));
          val=trim(substr($0,equal+1));
          if(match(val,/^".*"$/) || match(val,/^\047.*\047$/)){
            print key "=" val
          } else {
            print key "=\"" val "\""
          }
        }
      }
  ' >"$output"
  echo "$output"
}

IO:initialize # output settings
Script:meta   # find installation folder

[[ $run_as_root == 1 ]] && [[ ${UID:-0} -ne 0 ]] && IO:die "user is ${USER:-$(whoami)}, MUST be root to run [$script_basename]"
[[ $run_as_root == -1 ]] && [[ ${UID:-0} -eq 0 ]] && IO:die "user is ${USER:-$(whoami)}, CANNOT be root to run [$script_basename]"

Option:initialize # set default values for flags & options
Os:import_env     # load .env, .<prefix>.env, <prefix>.env (script folder + cwd)

if [[ $sourced -eq 0 ]]; then
  Option:parse "$@" # overwrite with specified options if any
  Script:initialize # clean up folders
  Script:main       # run Script:main program
  Script:exit       # exit and clean up
else
  # just disable the trap, don't execute Script:main
  trap - INT TERM EXIT
fi
