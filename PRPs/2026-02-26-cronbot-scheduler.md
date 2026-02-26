# PRP: cronbot — Self-Modifiable Agent Scheduling System

**Date:** 2026-02-26
**Confidence Score:** 8/10 (all major design decisions resolved)

## Objective

Build a bash-based (bashew framework) self-modifiable agent scheduling system. A script `cronbot` is called every minute by crontab. It decides fast whether any job needs to run, and if so, launches it by passing a `<JOB>.md` file to `claude -p`.

The key innovation: Claude itself can create, modify, and delete job files — making the schedule **self-modifiable** by the agent.

## Architecture

```
.claude/cronbot/                    # all cronbot state lives here (repo-local)
  ├── cronbot.sh                    # bashew script — the scheduler
  ├── jobs/                         # job definitions (one .md per job)
  │   ├── daily-summary.md          # each file = cron config + claude prompt
  │   ├── daily-summary.memory.md   # optional per-job persistent memory
  │   ├── email-check.md
  │   └── weekly-report.md
  ├── locks/                        # lock files for running jobs
  └── logs/                         # execution history
      ├── cronbot.log               # main scheduler log
      └── jobs/                     # per-job output logs
          ├── daily-summary/
          │   └── 2026-02-26_0900.log
          └── email-check/
              └── 2026-02-26_1430.log
```

### Job File Format

Each job is a single `.md` file with YAML frontmatter for scheduling metadata, followed by the prompt content passed to Claude:

```markdown
---
cron: "0 9 * * MON-FRI"
enabled: true
timeout: 300
description: "Summarize today's tasks"
singleton: true
continue: false
memory: true
notify_on_failure: "terminal-notifier -title 'cronbot FAIL' -message 'daily-summary failed'"
---

# Daily Summary

Check my calendar, emails, and task list.
Summarize the top priorities for today.
Write the summary to ~/daily-briefing.md.

## Safety guardrails
- Do NOT delete or overwrite any existing files
- Do NOT run any git push, git reset, or destructive commands
- If you encounter an error accessing a service, log the error and move on
- If unsure about an action, skip it and note it in the summary
```

**Frontmatter fields:**

| Field               | Required | Default | Description                                                                                                   |
|---------------------|----------|---------|---------------------------------------------------------------------------------------------------------------|
| `cron`              | YES      | —       | Standard 5-field cron expression                                                                              |
| `enabled`           | no       | `true`  | Set `false` to pause without deleting                                                                         |
| `timeout`           | no       | `300`   | Max seconds per execution       1.                                                                            |
| `description`       | no       | —       | Human-readable one-liner                                                                                      |
| `model`             | no       | —       | Override model (`sonnet`, `haiku`, `opus`)                                                                    |
| `allowedTools`      | no       | —       | Comma-separated tool allowlist for `claude -p`                                                                |
| `workdir`           | no       | —       | Working directory for claude execution                                                                        |
| `max_turns`         | no       | —       | Max agentic turns (`--max-turns`)                                                                             |
| `append_prompt`     | no       | —       | Extra text appended to prompt (e.g. date context)                                                             |
| `singleton`         | no       | `false` | If `true`, skip this run if previous invocation is still running                                              |
| `continue`          | no       | `false` | If `true`, use `claude --continue` to resume last session                                                     |
| `memory`            | no       | `false` | If `true`, load `<job>.memory.md` as context and instruct Claude to update it                                 |
| `sandbox`           | no       | `false` | If `true`, run with `--sandbox` (network-disabled, fs-restricted) instead of `--dangerously-skip-permissions` |
| `notify_on_failure` | no       | —       | CLI command to run on job failure (e.g. `terminal-notifier -title "FAIL" -message "$JOB_NAME"`)               |
| `notify_on_success` | no       | —       | CLI command to run on job success (e.g. `echo "$JOB_NAME OK" >> ~/notify.log`)                                |

### Crontab Entry

```cron
* * * * * /path/to/cronbot run 2>&1 | tail -20 >> /path/to/logs/cronbot.log
```

### Execution Flow (`cronbot run`)

```
1. Read current time: MINUTE, HOUR, DOM, MONTH, DOW
2. For each *.md file in jobs/ (skip *.memory.md):
   a. Parse YAML frontmatter (extract cron, enabled, timeout, singleton, etc.)
   b. Skip if enabled != true
   c. Match cron expression against current time
   d. If match:
      - If singleton=true, check lock file → skip if still running
      - Acquire lock file
      - Extract prompt body (everything after frontmatter)
      - If memory=true, prepend <job>.memory.md content to prompt
        + Append instruction: "Update <job>.memory.md with important findings"
      - Build claude args:
        + If continue=true: claude --continue --print "$prompt"
        + Else: claude -p "$prompt"
        + Add --model, --max-turns, --allowedTools if set
      - Launch in background with timeout
      - On completion:
        + Release lock
        + Log result (exit code, duration)
        + If exit != 0 && notify_on_failure set: eval notify command
        + If exit == 0 && notify_on_success set: eval notify command
3. Exit (total time: <1s for typical job counts)
```

### Self-Modification

Claude can modify its own schedule through normal file operations:

- **Create job:** Write a new `.md` file to `jobs/`
- **Edit job:** Modify frontmatter (change cron, toggle enabled) or prompt body
- **Delete job:** Remove the `.md` file
- **List jobs:** Read `jobs/` directory or call `cronbot list`
- **Update memory:** Write/edit `<job>.memory.md` to persist context across runs

To make this explicit, include instructions in CLAUDE.md:

```markdown
## Scheduling

You can manage your own scheduled jobs. Job files live in `.claude/cronbot/jobs/`.
- To schedule a new task: create a .md file in jobs/ with cron frontmatter
- To pause a job: set `enabled: false` in frontmatter
- To change frequency: edit the `cron:` field
- To cancel: delete the file
- To see what's scheduled: run `.claude/cronbot/cronbot.sh list`
- To persist context across runs: write to `<job>.memory.md` in the same directory

## Safety in scheduled jobs

Jobs run non-interactively with `--dangerously-skip-permissions`. Each job .md file
MUST include a "Safety guardrails" section defining what the job is NOT allowed to do.
The agent should self-terminate (exit early) if it's about to perform a dangerous or
irreversible action not covered by its guardrails.
```

### Per-Job Memory

When `memory: true` is set, the job gets persistent context:

- **File:** `jobs/<job-name>.memory.md` (sibling to the job file)
- **On launch:** Memory file contents are prepended to the prompt as context
- **During execution:** Claude is instructed to update the memory file with important findings, state, or decisions that should persist
- **Use cases:** Tracking last-seen values, accumulating summaries, remembering errors to avoid, building knowledge over time

```markdown
# Memory: daily-summary

## Last run
- Date: 2026-02-25
- Calendar had 3 meetings, 2 deadlines
- Email backlog: 12 unread

## Recurring patterns
- Monday mornings always have team standup at 09:30
- User prefers bullet-point format over prose
```

## CLI Actions (bashew)

```
cronbot [-h] [-q] [-v] [-f] [-l <log_dir>] [-t <tmp_dir>] <action> [<param>]

Actions:
  run              Check schedule, execute matching jobs (called by crontab)
  list             List all jobs with status, next run time, last run
  add <file.md>    Copy/move a .md file into the jobs/ directory
  remove <name>    Delete a job file (with confirmation unless -f)
  enable <name>    Set enabled: true in job frontmatter
  disable <name>   Set enabled: false in job frontmatter
  history [<name>] Show execution history (all jobs or specific job)
  edit <name>      Open job file in $EDITOR
  test <name>      Dry-run: show what would execute, without launching claude
  install          Set up the crontab entry for cronbot
  uninstall        Remove the crontab entry
  check            Verify dependencies (claude, awk, etc.)
  env              Show environment and config
```

## Implementation Details

### Cron Expression Matching (awk — single process for all jobs)

Instead of looping in bash (slow string ops per field per job), feed all job cron expressions to a single `awk` invocation that outputs matching job names.

**Why awk:** One fork total. All field matching (wildcards, ranges, steps, lists, day names) runs inside awk's native string/math engine — no subshells, no repeated `[[ ]]` chains.

```bash
function get_matching_jobs() {
  # Collect all enabled jobs as "jobname|cronexpr" lines, pipe to awk
  local job_lines=""
  for job_file in "${JOB_DIR}"/*.md; do
    [[ "$(basename "$job_file")" == *.memory.md ]] && continue
    local cron_expr enabled
    # Quick frontmatter extraction (no full parse yet)
    cron_expr=$(awk '/^---$/{n++; next} n==1 && /^cron:/{gsub(/^cron: *"?|"? *$/,"",$0); print; exit}' "$job_file")
    enabled=$(awk '/^---$/{n++; next} n==1 && /^enabled:/{gsub(/^enabled: *|^ */,"",$0); print; exit}' "$job_file")
    [[ "${enabled:-true}" == "false" ]] && continue
    [[ -z "$cron_expr" ]] && continue
    job_lines+="$(basename "$job_file" .md)|${cron_expr}"$'\n'
  done

  [[ -z "$job_lines" ]] && return

  # Single awk call: match all cron expressions against current time
  echo "$job_lines" | awk -v now_min="$(date +%-M)" \
                           -v now_hour="$(date +%-H)" \
                           -v now_dom="$(date +%-d)" \
                           -v now_month="$(date +%-m)" \
                           -v now_dow="$(date +%-u)" \
  'BEGIN { FS="|"
    # Day-of-week name map
    split("MON,TUE,WED,THU,FRI,SAT,SUN", dn, ",")
    for (i in dn) dow_map[dn[i]] = i
  }
  function field_match(pattern, value, fmin, fmax,    parts, i, lo, hi, step, rng) {
    if (pattern == "*") return 1
    # Handle step: */N or range/N
    step = 1
    if (index(pattern, "/")) {
      split(pattern, parts, "/")
      step = parts[2] + 0
      pattern = parts[1]
    }
    if (pattern == "*") {
      return (value % step == fmin % step) ? 1 : 0
    }
    # Handle comma-separated list
    split(pattern, parts, ",")
    for (i in parts) {
      # Translate day names
      if (parts[i] in dow_map) parts[i] = dow_map[parts[i]]
      # Handle range
      if (index(parts[i], "-")) {
        split(parts[i], rng, "-")
        lo = (rng[1] in dow_map) ? dow_map[rng[1]] : rng[1] + 0
        hi = (rng[2] in dow_map) ? dow_map[rng[2]] : rng[2] + 0
        for (v = lo; v <= hi; v += step) {
          if (v == value) return 1
        }
      } else {
        if (parts[i] + 0 == value) return 1
      }
    }
    return 0
  }
  {
    job = $1; cron = $2
    split(cron, f, " ")
    if (field_match(f[1], now_min, 0, 59) &&
        field_match(f[2], now_hour, 0, 23) &&
        field_match(f[3], now_dom, 1, 31) &&
        field_match(f[4], now_month, 1, 12) &&
        field_match(f[5], now_dow, 1, 7)) {
      print job
    }
  }'
}
```

**Supports:** `*`, exact (`5`), list (`1,3,5`), range (`1-5`), step (`*/15`), range+step (`1-5/2`), day names (`MON-FRI`).

**Performance:** ~1ms for 50 jobs (one awk fork + in-memory matching). The bash-loop alternative would take ~50ms+ due to per-field string ops.

### YAML Frontmatter Parsing (no external deps)

```bash
function parse_frontmatter() {
  local file="$1"
  local in_frontmatter=0
  local key value

  while IFS= read -r line; do
    if [[ "$line" == "---" ]]; then
      ((in_frontmatter++))
      [[ $in_frontmatter -ge 2 ]] && break
      continue
    fi
    if [[ $in_frontmatter -eq 1 ]]; then
      key="${line%%:*}"
      value="${line#*: }"
      value="${value#\"}"
      value="${value%\"}"
      # Export as JOB_<KEY>=value
      printf -v "JOB_${key^^}" '%s' "$value"
    fi
  done < "$file"
}

function extract_prompt() {
  local file="$1"
  # Return everything after the second '---'
  awk '/^---$/{n++; next} n>=2' "$file"
}
```

### Lock File & Singleton Mechanism

Lock files always track running jobs. The `singleton` frontmatter flag controls behavior:

- **`singleton: true`** — if lock exists and process is alive, skip this invocation entirely
- **`singleton: false` (default)** — lock is advisory only; stale locks are auto-cleaned but overlapping runs are allowed

```bash
LOCK_DIR="${script_install_folder}/locks"

function acquire_lock() {
  local job_name="$1"
  local is_singleton="${2:-false}"
  local lock_file="${LOCK_DIR}/${job_name}.lock"

  if [[ -f "$lock_file" ]]; then
    local lock_pid lock_age
    lock_pid=$(cat "$lock_file" 2>/dev/null)
    lock_age=$(( $(date +%s) - $(stat -f %m "$lock_file" 2>/dev/null || stat -c %Y "$lock_file") ))
    local timeout="${JOB_TIMEOUT:-300}"

    # Check if the locked process is still alive
    if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
      if [[ "$is_singleton" == "true" ]]; then
        IO:debug "Singleton job $job_name still running (pid=$lock_pid, ${lock_age}s), skipping"
        return 1
      else
        IO:debug "Job $job_name has overlapping run (pid=$lock_pid), proceeding anyway"
      fi
    else
      # Process is gone — stale lock
      if (( lock_age > timeout + 60 )); then
        IO:alert "Stale lock for $job_name (pid=$lock_pid gone, ${lock_age}s old), removing"
        rm -f "$lock_file"
      fi
    fi
  fi

  echo "$$" > "$lock_file"
  return 0
}

function release_lock() {
  local job_name="$1"
  rm -f "${LOCK_DIR}/${job_name}.lock"
}
```

### Job Execution

```bash
function execute_job() {
  local job_file="$1"
  local job_name
  job_name=$(basename "$job_file" .md)

  # Build prompt: memory (optional) + job body
  local prompt=""
  local memory_file="${JOB_DIR}/${job_name}.memory.md"

  if [[ "${JOB_MEMORY:-false}" == "true" ]] && [[ -f "$memory_file" ]]; then
    prompt="## Persistent Memory (from previous runs)\n\n"
    prompt+="$(cat "$memory_file")"
    prompt+="\n\n---\n\n"
  fi
  prompt+="$(extract_prompt "$job_file")"

  # Append memory-update instruction if memory is enabled
  if [[ "${JOB_MEMORY:-false}" == "true" ]]; then
    prompt+="\n\n---\n## Memory instruction\n"
    prompt+="Update the file ${memory_file} with important findings, state, "
    prompt+="or decisions from this run that should persist for future runs. "
    prompt+="Keep it concise. Preserve useful info from previous runs."
  fi

  local log_dir="${script_install_folder}/logs/jobs/${job_name}"
  Os:folder "$log_dir" 30  # cleanup logs older than 30 days
  local log_file="${log_dir}/$(date +%Y-%m-%d_%H%M).log"

  # Build claude invocation args
  local claude_args=()
  if [[ "${JOB_CONTINUE:-false}" == "true" ]]; then
    claude_args+=(--continue --print "$prompt")
  else
    claude_args+=(-p "$prompt")
  fi
  claude_args+=(--output-format text)
  if [[ "${JOB_SANDBOX:-false}" == "true" ]]; then
    claude_args+=(--sandbox)
  else
    claude_args+=(--dangerously-skip-permissions)
  fi

  # Optional flags
  [[ -n "${JOB_MODEL:-}" ]] && claude_args+=(--model "$JOB_MODEL")
  [[ -n "${JOB_MAX_TURNS:-}" ]] && claude_args+=(--max-turns "$JOB_MAX_TURNS")
  [[ -n "${JOB_ALLOWEDTOOLS:-}" ]] && claude_args+=(--allowedTools "$JOB_ALLOWEDTOOLS")

  local workdir="${JOB_WORKDIR:-${script_install_folder}}"

  IO:log "Executing job: $job_name"

  (
    cd "$workdir" || exit 1
    local start_time
    start_time=$(date +%s)
    timeout "${JOB_TIMEOUT:-300}" claude "${claude_args[@]}" > "$log_file" 2>&1
    local exit_code=$?
    local duration=$(( $(date +%s) - start_time ))

    if [[ $exit_code -eq 0 ]]; then
      echo "---EXIT:0 DURATION:${duration}s---" >> "$log_file"
      IO:log "Job $job_name completed successfully (${duration}s)"
      # Notify on success
      if [[ -n "${JOB_NOTIFY_ON_SUCCESS:-}" ]]; then
        JOB_NAME="$job_name" eval "${JOB_NOTIFY_ON_SUCCESS}" 2>/dev/null || true
      fi
    elif [[ $exit_code -eq 124 ]]; then
      echo "---EXIT:TIMEOUT DURATION:${duration}s---" >> "$log_file"
      IO:alert "Job $job_name timed out after ${JOB_TIMEOUT:-300}s"
      if [[ -n "${JOB_NOTIFY_ON_FAILURE:-}" ]]; then
        JOB_NAME="$job_name" JOB_ERROR="timeout" eval "${JOB_NOTIFY_ON_FAILURE}" 2>/dev/null || true
      fi
    else
      echo "---EXIT:${exit_code} DURATION:${duration}s---" >> "$log_file"
      IO:alert "Job $job_name failed with exit code $exit_code (${duration}s)"
      if [[ -n "${JOB_NOTIFY_ON_FAILURE:-}" ]]; then
        JOB_NAME="$job_name" JOB_ERROR="exit_${exit_code}" eval "${JOB_NOTIFY_ON_FAILURE}" 2>/dev/null || true
      fi
    fi

    release_lock "$job_name"
  ) &
}
```

### `list` Action Output

```
Job                  Cron             Enabled  Last Run              Next Run
───────────────────  ───────────────  ───────  ────────────────────  ────────────────────
daily-summary        0 9 * * MON-FRI  ✓       2026-02-26 09:00      2026-02-27 09:00
email-check          */30 * * * *     ✓       2026-02-26 14:30      2026-02-26 15:00
weekly-report        0 17 * * FRI     ✗       2026-02-21 17:00      —
```

### `install` Action

```bash
function do_install() {
  local cron_entry="* * * * * $(realpath "$0") run >> ${log_dir}/cronbot.log 2>&1"
  if crontab -l 2>/dev/null | grep -q "cronbot run"; then
    IO:alert "cronbot already in crontab"
    return 0
  fi
  (crontab -l 2>/dev/null; echo "$cron_entry") | crontab -
  IO:success "Added cronbot to crontab"
}
```

## Bashew Script Structure

```bash
#!/usr/bin/env bash

script_version="0.1.0"
readonly script_author="peter@forret.com"
readonly run_as_root=-1

#####################################################################
## HOW TO ADD A NEW VERB:
## 1. add the verb to Option:config as a choice
## 2. add the handler in Script:main case statement
## 3. implement the function do_<verb>()
#####################################################################

function Option:config() {
  grep <<< "
flag|h|help|show usage
flag|Q|QUIET|no output
flag|V|VERBOSE|also show debug messages
flag|f|FORCE|do not ask for confirmation
option|L|LOG_DIR|folder for log files|$HOME/log/cronbot
option|t|tmp_dir|folder for temp files|/tmp/cronbot
option|J|JOB_DIR|folder for job definitions|./jobs
choice|1|action|action to perform|run,list,add,remove,enable,disable,history,test,install,uninstall,check,env
param|?|input|job name or file path
" -v -e '^#' -e '^\s*$'
}

function Script:main() {
  IO:log "[$script_basename] $script_version started"
  Os:require "claude"
  Os:require "awk"

  case "${action,,}" in
  run)        do_run ;;
  list)       do_list ;;
  add)        do_add "$input" ;;
  remove)     do_remove "$input" ;;
  enable)     do_enable "$input" ;;
  disable)    do_disable "$input" ;;
  history)    do_history "$input" ;;
  test)       do_test "$input" ;;
  install)    do_install ;;
  uninstall)  do_uninstall ;;
  check|env)  Script:check ;;
  *)          IO:die "action [$action] not recognized" ;;
  esac
}

# ... helper functions (cron_matches, parse_frontmatter, etc.)
# ... action functions (do_run, do_list, etc.)

#####################################################################
################### DO NOT MODIFY BELOW THIS LINE ###################
#####################################################################
# bashew framework code
```

## Dependencies

- `bash` 4+ (associative arrays, `read -r`)
- `claude` CLI (installed and authenticated)
- `awk` (frontmatter/prompt extraction fallback)
- `date` (GNU or BSD — handle both)
- `crontab` (OS-level scheduler)
- `timeout` (GNU coreutils; on macOS use `gtimeout` from `brew install coreutils`)
- `stat` (handle GNU `-c %Y` vs BSD `-f %m`)

## Platform Compatibility Notes

macOS vs Linux differences to handle:

| Feature      | macOS (BSD)                    | Linux (GNU)  | Solution                                                                                 |
|--------------|--------------------------------|--------------|------------------------------------------------------------------------------------------|
| `date +%-M`  | Works                          | Works        | Portable                                                                                 |
| `stat` mtime | `stat -f %m`                   | `stat -c %Y` | Detect with `if stat --version 2>/dev/null`                                              |
| `timeout`    | `/opt/homebrew/bin/timeout`    | Built-in     | `Os:require "timeout"` — already available on macOS via coreutils                        |
| `date +%u`   | Works (1=Mon)                  | Works        | Portable                                                                                 |
| `crontab`    | Works                          | Works        | Portable                                                                                 |
| `realpath`   | Needs `brew install coreutils` | Built-in     | Use bashew's `Os:follow_link`                                                            |

## Claude Code Integration: Skills & Hooks

### Skill: `/cronbot`

A user-invocable skill for managing jobs from within a Claude session.

```
.claude/skills/cronbot/SKILL.md
```

```yaml
---
name: cronbot
description: Manage scheduled cronbot jobs (list, add, remove, enable, disable, history)
disable-model-invocation: false
allowed-tools: Bash(*/cronbot.sh *), Read, Write, Edit, Glob
argument-hint: "[list|add|remove|enable|disable|history|test] [job-name]"
---

## Cronbot — Scheduled Job Manager

Job files live in `.claude/cronbot/jobs/`. Each is a .md with YAML frontmatter (cron, enabled, timeout, etc.) and a prompt body.

### Available commands

- `/cronbot list` — show all jobs with status
- `/cronbot add <name>` — create a new job interactively (ask user for cron, prompt, options)
- `/cronbot remove <name>` — delete a job
- `/cronbot enable <name>` / `/cronbot disable <name>` — toggle a job
- `/cronbot history <name>` — show recent execution logs
- `/cronbot test <name>` — dry-run, show what would execute

### When invoked without arguments

Run `!`.claude/cronbot/cronbot.sh list`` and show the results.

### When adding a new job

1. Ask for: description, cron schedule, timeout, safety guardrails
2. Create the .md file in `.claude/cronbot/jobs/` with proper frontmatter
3. Every job MUST include a "Safety guardrails" section
4. Run `.claude/cronbot/cronbot.sh test <name>` to verify

### Frontmatter reference

!`cat .claude/cronbot/jobs/health-check.md | head -20`
```

### Skill: `/cronbot-memory` (auto-invocable)

Background knowledge skill that teaches Claude about the memory system — auto-loaded when Claude works in the `jobs/` directory.

```
.claude/skills/cronbot-memory/SKILL.md
```

```yaml
---
name: cronbot-memory
description: How cronbot per-job memory works
user-invocable: false
---

## Per-Job Memory

Each cronbot job can have a `<job>.memory.md` sibling file for persistent context.

- When `memory: true` in frontmatter, the memory file is prepended to the prompt
- Claude is instructed to update the memory file with important findings
- Memory files are gitignored (runtime state, not config)
- Keep memory files concise (<100 lines) — summarize, don't accumulate
```

### Hooks

#### PostToolUse: Validate job files on write

When Claude writes/edits a file in `jobs/`, validate frontmatter and warn if safety guardrails are missing.

```json
// .claude/settings.json (or .claude/settings.local.json)
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path // .tool_input.filePath // empty' | grep -q 'cronbot/jobs/.*\\.md$' && { FILE=$(jq -r '.tool_input.file_path // .tool_input.filePath'); grep -q '^cron:' \"$FILE\" || echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"message\":\"WARNING: Job file missing cron: field in frontmatter\"}}'; grep -qi 'guardrail\\|safety' \"$FILE\" || echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"message\":\"WARNING: Job file missing Safety guardrails section\"}}'; } || true"
          }
        ]
      }
    ]
  }
}
```

#### Stop: Log session completions for jobs

When a cronbot-launched Claude session ends, log the outcome. This hook is useful for debugging but not strictly required — cronbot already logs exit codes.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo \"$(date +%Y-%m-%dT%H:%M:%S) session stopped\" >> .claude/cronbot/logs/sessions.log"
          }
        ]
      }
    ]
  }
}
```

#### No proactive/cron hooks

Claude Code hooks are **reactive** (fire on agent events), not proactive. There is no `Schedule` or `Timer` hook event. That's exactly why `cronbot` exists — OS cron fills this gap by calling `cronbot run` every minute.

## Tasks (Implementation Order)

1. **Create bashew project scaffold**
   ```bash
   cd /Users/pforret/Code/AI/TropicClaw
   bashew -f -n "cronbot" script
   ```
   Or manually create `cronbot.sh` using bashew template conventions.

2. **Implement YAML frontmatter parser** (`parse_frontmatter`, `extract_prompt`)
   - Pure bash, no external deps
   - Handle quoted and unquoted values
   - Export as `JOB_*` variables

3. **Implement cron expression matcher** (`cron_matches`, `field_matches`)
   - Support: `*`, exact, comma-list, range, step, range+step, day-of-week names
   - Must be fast (<10ms per expression)
   - Unit test with known cron expressions

4. **Implement `run` action** (the core loop)
   - Iterate `jobs/*.md`, parse frontmatter, check cron match
   - Lock file mechanism (prevent duplicates)
   - Background execution with timeout
   - Logging to per-job log directory

5. **Implement `list` action**
   - Table output with job name, cron, enabled, last run, description
   - Calculate "next run" from cron expression (nice-to-have, can be v2)

6. **Implement `add` / `remove` actions**
   - `add`: validate frontmatter, copy to jobs/
   - `remove`: confirm (unless -f), delete from jobs/

7. **Implement `enable` / `disable` actions**
   - Toggle `enabled:` field in frontmatter via sed

8. **Implement `history` action**
   - Read log directory, show last N executions with exit status

9. **Implement `test` action**
   - Dry-run: show parsed frontmatter, matched/not-matched, prompt preview

10. **Implement `install` / `uninstall` actions**
    - Add/remove crontab entry

11. **Implement memory loading/saving**
    - Prepend `<job>.memory.md` to prompt when `memory: true`
    - Append memory-update instruction to prompt
    - Create empty memory file if missing

12. **Implement notification hooks**
    - Run `notify_on_failure` / `notify_on_success` commands after job completion
    - Export `$JOB_NAME`, `$JOB_ERROR` for use in notification commands
    - Never let notification failure affect job status

13. **Create sample job files**
    - `jobs/health-check.md` — simple test with safety guardrails
    - `jobs/daily-summary.md` — example with memory + singleton + notify

14. **Create `/cronbot` skill**
    - `.claude/skills/cronbot/SKILL.md` — user-invocable job management
    - `.claude/skills/cronbot-memory/SKILL.md` — auto-invocable memory docs

15. **Create hooks**
    - PostToolUse hook: validate job files on write (cron field + safety guardrails)
    - Stop hook: log session completions (optional)

16. **Create CLAUDE.md additions**
    - Document self-modification instructions for Claude
    - Document safety guardrail requirements for job files

17. **Test end-to-end**
    - Install crontab, add a test job, verify execution, check logs
    - Test singleton behavior (overlapping prevention)
    - Test memory persistence across runs
    - Test notification on failure/success
    - Test `/cronbot list` skill from interactive session

## Validation Gates

```bash
# Syntax check
shellcheck cronbot.sh

# Verify bashew structure
grep -q "Script:main" cronbot.sh && echo "OK: main function exists"
grep -q "Option:config" cronbot.sh && echo "OK: option config exists"
grep -q "DO NOT MODIFY BELOW" cronbot.sh && echo "OK: bashew framework present"

# Unit test: cron matching
cronbot test health-check  # should show parsed result

# Integration test: run cycle
cronbot run  # should complete in <1s with no matching jobs

# Verify actions
cronbot list
cronbot check
cronbot env
```

## Error Handling

| Scenario                          | Behavior                                                     |
|-----------------------------------|--------------------------------------------------------------|
| `claude` not installed            | `Os:require` fails at startup with install hint              |
| Invalid cron expression           | Log warning, skip job, continue to next                      |
| Job file has no frontmatter       | Skip with warning                                            |
| Singleton lock (process alive)    | Skip with debug message                                      |
| Stale lock (process dead)         | Auto-remove, log alert                                       |
| `claude -p` fails                 | Log exit code, release lock, run `notify_on_failure` if set  |
| `claude -p` times out             | Kill process, log timeout, run `notify_on_failure` if set    |
| `claude -p` succeeds              | Log success, run `notify_on_success` if set                  |
| Empty jobs/ directory             | Exit silently (normal for `run`)                             |
| Permission denied on jobs/        | `IO:die` with error                                          |
| Memory file missing (memory=true) | Create empty memory file, proceed normally                   |
| Notification command fails        | Log warning, continue (never fail the job over notification) |

## Prior Art

Only **2 projects** implement true agent-driven schedule CRUD. Everything else uses static cron where a human defines the schedule.

| Project | Self-modifiable? | Notes |
|---------|-----------------|-------|
| **[OpenClaw](https://docs.openclaw.ai/automation/cron-jobs)** | YES | Full CRUD via `cron.add/update/remove` tools. Jobs persist at `~/.openclaw/cron/jobs.json`. Gateway-resident scheduler. |
| **[Agent Zero](https://github.com/agent0ai/agent-zero)** | PARTIAL | Built-in Scheduler Tool; agent can create tasks with cron expressions. Update/delete via tool invocation not fully documented. |
| [claude-code-scheduler](https://github.com/jshchnz/claude-code-scheduler) | No | Plugin. Natural-language scheduling, launchd/crontab integration, worktree isolation. Agent is execution target only. |
| [claude-tasks](https://github.com/kylemclaren/claude-tasks) | No | Go TUI, SQLite, 6-field cron, usage-aware throttling. User manages via TUI. |
| [nanoclaw](https://github.com/qwibitai/nanoclaw) | Unclear | Lightweight OpenClaw on Agent SDK. Has `nanoclaw cron list/add/remove` CLI but unclear if agent can invoke programmatically. |
| [claude-mcp-scheduler](https://github.com/tonybentley/claude-mcp-scheduler) | No | Claude API + cron + MCP. Static config. |
| [runCLAUDErun](https://runclauderun.com/) | No | macOS native app. GUI-only scheduling. |

**Anthropic's stance:** [Issue #4785](https://github.com/anthropics/claude-code/issues/4785) — scheduling should be built on the SDK, not in core. Closed as "Not Planned."

**cronbot's differentiator:** File-based schedule (`.md` files) that Claude can read/write with its existing tools — no MCP server or custom API needed. The agent modifies its own schedule by editing files it already has access to.

## Key References

- **bashew framework:** https://github.com/pforret/bashew — installed via basher at `/Users/pforret/.basher/cellar/bin/bashew`
- **bashew conventions:** Option:config pipe-delimited syntax, Script:main case switch, IO:*/Os:*/Str:* utility functions
- **Claude CLI non-interactive:** `claude -p "prompt"` — no TTY needed, works in cron
- **Claude CLI flags:** `--output-format text|json`, `--model`, `--max-turns`, `--allowedTools`
- **Existing scheduler projects for reference:**
  - https://github.com/jshchnz/claude-code-scheduler (plugin-based, JSON config)
  - https://github.com/kylemclaren/claude-tasks (TUI, SQLite, usage-aware)
- **OpenClaw scheduling spec:** https://github.com/pforret/clarabot/blob/main/docs/AI-assistant/OPENCLAW_ARCHITECTURE.md
- **Cron expression reference:** https://crontab.guru/

## Resolved Design Decisions

1. **Job directory:** `.claude/cronbot/jobs/` — repo-local, gitignore-able
2. **Permissions:** Default: `--dangerously-skip-permissions` (non-interactive). Per-job `sandbox: true` flag switches to `--sandbox` (network-disabled, fs-restricted) for safer execution. Each job `.md` MUST include a "Safety guardrails" section defining what the agent should NOT do. The agent self-terminates before dangerous/irreversible actions.
3. **Concurrency:** Per-job `singleton: true` flag prevents overlapping runs of the same job. No global concurrency limit (keep it simple; add later if needed).
4. **Session continuity:** Per-job `continue: true` flag uses `claude --continue --print`. Per-job `memory: true` flag loads/saves `<job>.memory.md` for persistent context across fresh sessions.
5. **Notifications:** Per-job `notify_on_failure` and `notify_on_success` frontmatter fields, each a CLI command string. Variables `$JOB_NAME` and `$JOB_ERROR` are available in the command.

## All Questions Resolved

- **`.gitignore`:** Commit job definitions (`.claude/cronbot/jobs/*.md`), gitignore logs, locks, and memory files (`.claude/cronbot/logs/`, `.claude/cronbot/locks/`, `*.memory.md`)
- **`timeout`:** Use `/opt/homebrew/bin/timeout` on macOS (already available), `timeout` on Linux. Detect with `command -v timeout || command -v gtimeout`.
