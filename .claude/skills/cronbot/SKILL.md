---
name: cronbot
description: Manage scheduled cronbot jobs (list, add, remove, enable, disable, history, test)
disable-model-invocation: false
allowed-tools: Bash(*/cronbot.sh *), Read, Write, Edit, Glob
argument-hint: "[list|add|remove|enable|disable|history|test] [job-name]"
---

## Cronbot — Scheduled Job Manager

Job files live in `.claude/cronbot/jobs/`. Each is a `.md` with YAML frontmatter (cron, enabled, timeout, etc.) and a prompt body.

### Available commands

- `/cronbot list` — show all jobs with status
- `/cronbot add <name>` — create a new job interactively (ask user for cron, prompt, options)
- `/cronbot remove <name>` — delete a job
- `/cronbot enable <name>` / `/cronbot disable <name>` — toggle a job
- `/cronbot history <name>` — show recent execution logs
- `/cronbot test <name>` — dry-run, show what would execute

### When invoked without arguments

Run `.claude/cronbot/cronbot.sh list` and show the results.

### When adding a new job

1. Ask for: description, cron schedule, timeout, safety guardrails
2. Create the `.md` file in `.claude/cronbot/jobs/` with proper frontmatter
3. Every job MUST include a "Safety guardrails" section
4. Run `.claude/cronbot/cronbot.sh test <name>` to verify

### Frontmatter fields

| Field | Default | Description |
|-------|---------|-------------|
| `cron` | (required) | 5-field cron expression |
| `enabled` | true | Set false to pause |
| `timeout` | 300 | Max seconds |
| `singleton` | false | Skip if previous run still active |
| `continue` | false | Resume last session |
| `memory` | false | Load/save `<job>.memory.md` |
| `sandbox` | false | Use `--sandbox` (restricted) |
| `model` | — | Override model |
| `notify_on_failure` | — | CLI command on failure |
| `notify_on_success` | — | CLI command on success |

### Example job file

```markdown
---
cron: "0 9 * * MON-FRI"
enabled: true
timeout: 300
singleton: true
memory: true
description: "Daily task summary"
---

# Daily Summary

Summarize today's priorities.

## Safety guardrails
- Do NOT delete files
- Do NOT run destructive commands
```
