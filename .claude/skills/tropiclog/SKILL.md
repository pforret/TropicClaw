---
name: tropiclog
description: View and manage audit logs for Claude Code sessions
disable-model-invocation: true
allowed-tools: Bash(*/tropiclog.sh *), Read, Glob
argument-hint: "[status|search|list|stats|export|tail|clean|install|uninstall|check] [args]"
---

Manage audit logs that track all tool calls across Claude Code sessions.

Audit logs use Claude Code hooks to record every tool call, result, and session
lifecycle event as append-only JSON-lines files. Each session gets its own
`.jsonl` file under `.claude/tropiclog/logs/sessions/`.

## Usage

- `/tropiclog status` — Show audit logging status (hooks installed, log size, entry count)
- `/tropiclog search <query>` — Search all logs for keyword matches
- `/tropiclog list` — List recent sessions (also: `list tools`, `list errors`)
- `/tropiclog stats [session-id]` — Show tool usage statistics (per-session or global)
- `/tropiclog export [session-id]` — Export logs (`--FORMAT json|csv|text`)
- `/tropiclog tail [session-id]` — Show last 20 entries from most recent session
- `/tropiclog clean` — Remove logs older than 30 days (`--DAYS N`, `--FORCE`)
- `/tropiclog install` — Register hooks in `.claude/settings.local.json`
- `/tropiclog uninstall` — Remove hooks from settings
- `/tropiclog check` — Verify dependencies (jq) and hook registration

## First-Time Setup

1. Run `/tropiclog install` to register the hooks
2. Run `/tropiclog check` to verify everything is configured
3. Use Claude Code normally — all tool calls are now logged
4. Run `/tropiclog status` to see accumulated logs

Run the command:

```bash
.claude/tropiclog/tropiclog.sh $ARGUMENTS
```
