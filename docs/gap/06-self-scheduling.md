# Gap Analysis: Self-Modifying Schedule

## OpenClaw Feature

OpenClaw's agent can **inspect, create, modify, and delete its own scheduled jobs** at runtime. This goes beyond static cron: the agent treats its schedule as mutable state, adapting it based on conversation context, user requests, or its own reasoning.

### Capabilities

- **CRUD on scheduled jobs** — the agent can list its current jobs, add new ones, update frequency/timing, pause, resume, or delete them
- **Flexible recurrence** — supports arbitrary intervals: every N minutes, hourly, daily, weekly, monthly, or cron expressions
- **Natural-language scheduling** — user says "remind me every Monday at 9am" and the agent translates to a recurring job
- **Context-aware rescheduling** — the agent can decide to increase/decrease frequency based on observed conditions (e.g., poll an API more often during business hours, back off when idle)
- **Job persistence** — schedules survive restarts; stored in a durable store (DB, file, or config)
- **Per-agent scoping** — each agent/persona manages its own schedule independently
- **Job payloads** — each scheduled job carries a prompt or action to execute when triggered
- **Delivery control** — `--announce` sends results to the channel; `--no-deliver` runs quietly

### CLI Syntax

```bash
openclaw cron add --schedule "0 9 * * *" --agent personal \
  --prompt "Check new emails, send summary to Telegram" --announce
```

### Heartbeat

**Heartbeat** is a special short-cycle periodic check against `HEARTBEAT.md` — a checklist of things to verify:

- Is monitoring running?
- Is disk space okay?
- Any errors in the logs?

If something is wrong, the agent messages you proactively.

### Integration Example

Want Gmail checked every morning with a summary sent to Telegram:
1. Enable browser tool (with saved session for Gmail auth)
2. Set 9:00 cron with `--announce`
3. Write the instruction in `AGENTS.md`
4. Every morning: agent opens browser → reads inbox → filters by relevant senders → sends summary
5. You haven't finished your coffee and it's already handled

### Example Scenarios

| Scenario                           | Agent Behavior                                     |
|------------------------------------|----------------------------------------------------|
| User: "Check my email every hour"  | Creates hourly job with email-check prompt         |
| User: "Make that every 30 minutes" | Updates existing job's interval                    |
| User: "Stop checking on weekends"  | Modifies cron expression to weekdays only          |
| Agent detects API rate-limiting    | Self-reduces polling frequency, logs reason        |
| User: "What jobs are running?"     | Lists all active scheduled jobs with next-run time |
| User: "Cancel the email check"     | Deletes the job                                    |

## Claude Code Coverage

| Feature                         | Status  | Claude Code Primitive                                |
|---------------------------------|---------|------------------------------------------------------|
| Run a prompt on schedule        | Partial | Cronbot (`.claude/cronbot/`) — bash-based job scheduler with cron matching |
| External cron invocation        | Partial | OS cron/launchd + `claude -p "prompt"`               |
| Token-efficient health checks   | Yes     | Cronbot `precheck:` field — bash pre-check skips LLM if exit 0 + no output |
| Agent reads its own schedule    | No      | —                                                    |
| Agent modifies its own schedule | No      | —                                                    |
| Job persistence                 | No      | —                                                    |
| Natural-language → schedule     | Partial | Claude can parse intent, but has nowhere to write it |

**What works:**

- `claude -p "prompt"` allows external schedulers to trigger agent actions
- Claude can parse natural-language time expressions and output cron syntax
- Hooks (`Stop`, `Notification`) could emit events when jobs complete

## Gaps

| Gap                      | Severity | Notes                                                                       |
|--------------------------|----------|-----------------------------------------------------------------------------|
| No scheduler process     | ~~HIGH~~ → **ADDRESSED** | Cronbot provides bash-based cron matching + job execution via `cronbot.sh run` |
| No schedule store        | ~~HIGH~~ → **ADDRESSED** | Job definitions stored as `.md` files with YAML frontmatter in `.claude/cronbot/jobs/` |
| No self-modification API | MEDIUM   | Agent can write/edit job `.md` files directly, but no dedicated tool API    |
| No job execution loop    | ~~HIGH~~ → **ADDRESSED** | Cronbot runs every minute via OS crontab, matches jobs, launches `claude -p` |
| No job status/history    | ~~MEDIUM~~ → **ADDRESSED** | Per-job log files in `logs/jobs/<name>/`, `cronbot.sh list` shows last run |
| No retry/backoff         | LOW      | Failed jobs aren't automatically retried                                    |
| No token-efficient checks | ~~MEDIUM~~ → **ADDRESSED** | `precheck:` frontmatter runs bash first; skips LLM if all-clear (exit 0, no stdout) |

## Build Recommendations

### Option A: Schedule MCP Server

Build an MCP server that exposes schedule CRUD as tools the agent can call:

```
Tools:
  schedule.list          → returns all active jobs
  schedule.create        → adds a new job (cron expr, prompt, metadata)
  schedule.update        → modifies an existing job
  schedule.delete        → removes a job
  schedule.pause/resume  → toggles a job without deleting it
  schedule.history       → returns recent execution log
```

The MCP server runs as a persistent process alongside the gateway, backed by a durable store (SQLite, JSON file, or Redis). A job runner loop checks the schedule and invokes `claude -p` or the Claude API when jobs fire.

### Option B: Crontab Wrapper Tool

Lighter approach: give the agent a Bash-based tool that reads/writes the OS crontab directly. Each cron entry calls `claude -p "job prompt"`.

- **Pro:** No custom scheduler needed; leverages OS cron
- **Con:** OS cron has no concept of pause/resume, limited metadata, no execution history, platform-dependent (crontab vs launchd)

### Option C: Hook-Driven Schedule File

The agent writes schedule definitions to a JSON/YAML file. An external watcher process monitors the file and syncs entries to the actual scheduler (cron, launchd, systemd timer, or node-cron).

- **Pro:** Agent only needs file-write capability (already has it)
- **Con:** Indirect; requires a sidecar process; no real-time feedback

### Recommended Approach

**Option A (MCP server)** provides the cleanest integration. The agent calls `schedule.create` the same way it calls any other tool, the MCP server handles persistence and execution, and the agent can query `schedule.list` to see its own jobs. This matches OpenClaw's model most closely.

## Verdict

**YELLOW** — Cronbot addresses the core scheduling gaps: job storage (`.md` files), cron matching (bash/awk), job execution (`claude -p`), history/logs, and token-efficient prechecks. The remaining gaps are: no dedicated tool API for self-modification (agent must write files directly), no retry/backoff, and no natural-language schedule parsing. An MCP server wrapping cronbot would close these remaining gaps.
