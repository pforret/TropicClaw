---
name: auditlog
description: View and manage audit logs for Claude Code sessions
disable-model-invocation: true
allowed-tools: Bash(*/auditlog.sh *), Read, Glob
argument-hint: "[status|search|list|stats|export|tail|clean|install|uninstall|check] [args]"
---

Manage audit logs that track all tool calls across Claude Code sessions.

Audit logs use Claude Code hooks to record every tool call, result, and session
lifecycle event as append-only JSON-lines files. Each session gets its own
`.jsonl` file under `.claude/auditlog/logs/sessions/`.

## Usage

- `/auditlog status` — Show audit logging status (hooks installed, log size, entry count)
- `/auditlog search <query>` — Search all logs for keyword matches
- `/auditlog list` — List recent sessions (also: `list tools`, `list errors`)
- `/auditlog stats [session-id]` — Show tool usage statistics (per-session or global)
- `/auditlog export [session-id]` — Export logs (`--FORMAT json|csv|text`)
- `/auditlog tail [session-id]` — Show last 20 entries from most recent session
- `/auditlog clean` — Remove logs older than 30 days (`--DAYS N`, `--FORCE`)
- `/auditlog install` — Register hooks in `.claude/settings.local.json`
- `/auditlog uninstall` — Remove hooks from settings
- `/auditlog check` — Verify dependencies (jq) and hook registration

## First-Time Setup

1. Run `/auditlog install` to register the hooks
2. Run `/auditlog check` to verify everything is configured
3. Use Claude Code normally — all tool calls are now logged
4. Run `/auditlog status` to see accumulated logs

Run the command:

```bash
.claude/auditlog/auditlog.sh $ARGUMENTS
```
