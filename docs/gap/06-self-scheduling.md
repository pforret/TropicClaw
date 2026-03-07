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

## Claude Code Coverage (via Tropicron)

Tropicron (`.claude/tropicron/`) is a purpose-built scheduling system for Claude Code. It replaces the earlier "cronbot" prototype with a full-featured bash-based scheduler.

### Architecture

- **Runner:** `tropicron.sh` — called every minute by OS crontab, matches cron expressions via awk, launches `claude -p` for matching jobs
- **Job store:** `.md` files with YAML frontmatter in `.claude/tropicron/jobs/`
- **Skill:** `/tropicron` slash command for interactive job management (list, add, remove, enable, disable, history, test)
- **Memory skill:** `tropicron-memory` — documents per-job persistent memory via `<job>.memory.md` sibling files

### Feature Coverage

| Feature                         | Status  | Tropicron Primitive                                  |
|---------------------------------|---------|------------------------------------------------------|
| Run a prompt on schedule        | **Yes** | `tropicron.sh run` — cron matching + `claude -p`     |
| External cron invocation        | **Yes** | OS crontab calls `tropicron.sh run` every minute     |
| Token-efficient health checks   | **Yes** | `precheck:` field — bash pre-check skips LLM if exit 0 + no stdout |
| Agent reads its own schedule    | **Yes** | `/tropicron list` or `tropicron.sh list` — shows all jobs with status, last run, next run |
| Agent modifies its own schedule | **Yes** | Agent can create/edit/delete job `.md` files; `/tropicron add|remove|enable|disable` |
| Job persistence                 | **Yes** | Jobs stored as `.md` files, survive restarts         |
| Natural-language → schedule     | **Yes** | `/tropicron add` skill asks user interactively, Claude translates to cron expression |
| Per-job memory                  | **Yes** | `memory: true` — loads/saves `<job>.memory.md` for cross-run context |
| Singleton/overlap protection    | **Yes** | `singleton: true` — skips job if previous run still active (PID file check) |
| Session continuity              | **Yes** | `continue: true` — uses `--continue` to resume previous Claude session |
| Sandbox mode                    | **Yes** | `sandbox: true` — runs with `--sandbox` instead of `--dangerously-skip-permissions` |
| Model override                  | **Yes** | `model:` frontmatter selects per-job model           |
| Tool restrictions               | **Yes** | `allowedTools:` limits which tools the job can use   |
| Failure/success notifications   | **Yes** | `notify_on_failure:` / `notify_on_success:` run arbitrary shell commands |
| Execution history               | **Yes** | Per-job logs in `~/log/tropicron/`, `tropicron.sh history` |
| Dry-run testing                 | **Yes** | `tropicron.sh test <name>` — shows what would execute without running |
| Install/uninstall               | **Yes** | `tropicron.sh install|uninstall` — manages the OS crontab entry |
| Precheck helpers                | **Yes** | `url-changed.sh` (URL diff detection), `cli-changed.sh` (CLI output diff detection) |

### Frontmatter Fields

| Field | Default | Description |
|-------|---------|-------------|
| `cron` | (required) | 5-field cron expression (supports ranges, steps, DOW names) |
| `enabled` | true | Set false to pause |
| `timeout` | 300 | Max seconds |
| `singleton` | false | Skip if previous run still active |
| `continue` | false | Resume last Claude session |
| `memory` | false | Load/save `<job>.memory.md` |
| `sandbox` | false | Use `--sandbox` (restricted permissions) |
| `model` | — | Override model (e.g., `sonnet`) |
| `max_turns` | — | Limit Claude's tool-use turns |
| `allowedTools` | — | Comma-separated tool allowlist |
| `workdir` | — | Working directory override |
| `precheck` | — | Bash command; skip LLM if exit 0 + no stdout |
| `notify_on_failure` | — | Shell command on failure |
| `notify_on_success` | — | Shell command on success |

### Example Jobs

- **health-check.md** — every 30 min, sandbox mode, simple liveness check
- **daily-summary.md** — weekday 9am, memory-enabled, summarizes tasks
- **url-monitor.md** — every 6h, precheck-driven URL change detection
- **system-health.md** — every 15 min, precheck for disk/cron issues

## Remaining Gaps

| Gap                      | Severity | Notes                                                                       |
|--------------------------|----------|-----------------------------------------------------------------------------|
| No retry/backoff         | LOW      | Failed jobs aren't automatically retried; `notify_on_failure` can alert     |
| No MCP tool API          | LOW      | Agent uses file I/O + skill, not structured MCP tools — works but less discoverable |
| No cross-project jobs    | LOW      | Each project has its own `tropicron/jobs/`; no global job registry          |
| No web dashboard         | LOW      | CLI-only management; no visual overview of jobs/history                     |

## Build Recommendations (Future)

### Option A: Schedule MCP Server

Wrap tropicron in an MCP server exposing schedule CRUD as tools. This would make jobs discoverable via `schedule.list`, `schedule.create`, etc. without the agent needing to know the file format.

- **Pro:** Cleanest integration; agent calls tools like any other MCP tool
- **Con:** Extra process; tropicron already works well via skill + file I/O

### Option B: Retry/Backoff Extension

Add `retry: 3` and `backoff: exponential` frontmatter fields to tropicron. On failure, re-queue the job with increasing delay.

- **Pro:** Simple extension to existing system
- **Con:** Needs careful interaction with singleton mode

### Current Recommended Approach

Tropicron's skill-based approach (`/tropicron add|list|enable|disable`) combined with direct file manipulation already covers the core OpenClaw scheduling model. An MCP wrapper would add discoverability but is not blocking.

## Verdict

**GREEN** — Tropicron fully addresses the self-scheduling gap. The agent can create, read, update, and delete its own scheduled jobs via the `/tropicron` skill or direct file editing. Jobs persist as `.md` files, support flexible cron expressions, per-job memory, precheck-based token efficiency, singleton protection, session continuity, sandbox mode, model/tool overrides, and failure/success notifications. The only remaining gaps are minor: no automatic retry/backoff, no MCP tool API (skill works fine), and no cross-project job registry.
