# PRP: auditlog — Append-Only Audit Logging for Claude Code

**Date:** 2026-02-27
**Confidence Score:** 8/10 (design proven by cronbot pattern; hook I/O format verified)

## Objective

Build a bash-based (bashew framework) audit logging system that records every Claude Code tool call and session lifecycle event as append-only JSON-lines files. This addresses two gaps from the OpenClaw → Claude Code gap analysis:

1. **No append-only session logs** (Agent Runtime, MEDIUM) — Claude Code has internal transcripts but no structured audit format
2. **No conversation indexing** (Agent Runtime, LOW) — Past sessions aren't searchable or queryable

The system has two parts:
- **Hook scripts** — Called by Claude Code on every tool use and session event, appending one JSON line per event
- **CLI** — bashew-based script for querying, searching, exporting, and managing audit logs

## Architecture

```
.claude/auditlog/                    # all auditlog state lives here
  ├── auditlog.sh                    # bashew script — CLI for query/management
  ├── hooks/                         # hook scripts called by Claude Code
  │   ├── on-tool-use.sh             # PreToolUse + PostToolUse + PostToolUseFailure
  │   └── on-session.sh              # SessionStart + SessionEnd
  └── logs/
      └── sessions/                  # per-session JSON-lines files
          ├── <session-id-1>.jsonl
          └── <session-id-2>.jsonl
```

### Hook Architecture

```
                     ┌─────────────────────────┐
                     │     Claude Code          │
                     │                          │
                     │  PreToolUse ──────┐      │
                     │  PostToolUse ─────┤      │
                     │  PostToolUseFailure┤     │
                     │  SessionStart ────┤      │
                     │  SessionEnd ──────┘      │
                     └────────────┬─────────────┘
                                  │ stdin: JSON
                                  ▼
                     ┌─────────────────────────┐
                     │  hooks/on-tool-use.sh    │
                     │  hooks/on-session.sh     │
                     │                          │
                     │  Extract: session_id,    │
                     │    tool_name, tool_input  │
                     │  Append: one JSON line   │
                     └────────────┬─────────────┘
                                  │ >> append
                                  ▼
                     ┌─────────────────────────┐
                     │  logs/sessions/          │
                     │    <session-id>.jsonl     │
                     │                          │
                     │  One file per session,   │
                     │  one line per event      │
                     └─────────────────────────┘
```

### JSON-Lines Format

Each line is a self-contained JSON object:

```json
{"ts":"2026-02-27T14:30:45Z","event":"session_start","session":"abc123","seq":0}
{"ts":"2026-02-27T14:30:46Z","event":"tool_call","session":"abc123","tool":"Bash","input_summary":"git status","seq":1}
{"ts":"2026-02-27T14:30:48Z","event":"tool_result","session":"abc123","tool":"Bash","status":"success","output_lines":15,"seq":2}
{"ts":"2026-02-27T14:30:49Z","event":"tool_call","session":"abc123","tool":"Read","input_summary":"/home/user/file.txt","seq":3}
{"ts":"2026-02-27T14:30:49Z","event":"tool_result","session":"abc123","tool":"Read","status":"success","output_lines":42,"seq":4}
{"ts":"2026-02-27T14:31:00Z","event":"session_end","session":"abc123","tool_calls":2,"errors":0,"seq":5}
```

**Entry types:**

| Event | When | Key fields |
|-------|------|-----------|
| `session_start` | SessionStart hook | ts, session, seq |
| `tool_call` | PreToolUse hook | ts, session, tool, input_summary, seq |
| `tool_result` | PostToolUse hook | ts, session, tool, status, output_lines, seq |
| `tool_result` (error) | PostToolUseFailure hook | ts, session, tool, status:"error", error, seq |
| `session_end` | SessionEnd hook | ts, session, tool_calls, errors, seq |

**Input summary extraction** — The hook picks the most descriptive field from tool_input:

| Tool | Field used |
|------|-----------|
| Bash | `.command` |
| Read, Write, Edit | `.file_path` |
| Glob, Grep | `.pattern` |
| WebSearch | `.query` |
| WebFetch | `.url` |
| Skill | `.skill` |
| Task | `.prompt` |
| Others | `tostring` (truncated to 200 chars) |

## CLI Verbs

| Verb | Usage | Description |
|------|-------|-------------|
| `status` | `auditlog status` | Show hooks installed, log size, entry count, session count |
| `search` | `auditlog search <query>` | Grep through all logs for keyword matches |
| `list` | `auditlog list [sessions\|tools\|errors]` | List sessions (default), tool usage, or errors |
| `stats` | `auditlog stats [session-id]` | Per-session or global tool usage statistics |
| `export` | `auditlog export [session-id] --FORMAT json\|csv\|text` | Export logs in specified format |
| `tail` | `auditlog tail [session-id]` | Show last 20 entries (most recent session if none specified) |
| `clean` | `auditlog clean --DAYS 30 --FORCE` | Remove logs older than N days |
| `install` | `auditlog install` | Register hooks in `.claude/settings.local.json` |
| `uninstall` | `auditlog uninstall` | Remove hooks from settings |
| `check` | `auditlog check` | Verify jq, hook scripts, settings registration, log dir |

## Design Decisions

### 1. Separate hook scripts from main CLI

Hook scripts are called on every tool use and **block Claude Code** until they complete. They must be minimal: read stdin, extract fields, append one line. No framework overhead.

The main `auditlog.sh` (bashew-based) handles all querying and management. It's only called by humans or Claude via the `/auditlog` skill.

### 2. Per-session files (not monolithic log)

Each session gets its own `.jsonl` file named by session_id. This makes:
- Per-session queries trivial (just read the file)
- Cleanup easy (delete by file modification date)
- Concurrent sessions safe (different files)

### 3. jq with graceful fallback

Hook scripts use `jq` for JSON parsing when available but fall back to `grep`/`sed` extraction when it's not. The CLI's advanced features (stats, export csv, formatted tail) require `jq`.

### 4. No lock files needed

Unlike cronbot (where cron might trigger overlapping runs), Claude Code hooks run sequentially within a session. Each session writes to its own file. No concurrency control needed.

### 5. Hooks registered via `install` verb

Rather than requiring manual JSON editing, `auditlog install` uses `jq` to deep-merge hook entries into the existing `.claude/settings.local.json`. This preserves existing hooks and permissions.

## Mapping to OpenClaw

| OpenClaw Feature | auditlog Coverage |
|------------------|-------------------|
| Append-only session logs | Yes — JSON-lines, one entry per line |
| Entry types: user, assistant, tool_call, tool_result | Partial — tool_call, tool_result, session_start, session_end (no user/assistant text) |
| Storage at `~/.openclaw/agents/<id>/sessions/` | Adapted — `.claude/auditlog/logs/sessions/<session-id>.jsonl` |
| Composite key (agentId, sessionKey) | Simplified — session_id only (single agent) |
| Searchable/filterable | Yes — via `search`, `list`, `stats` CLI |
| Scoped by agent/channel/time | Partial — scoped by session and time; no agent/channel scope (single agent) |

**What's NOT covered** (requires Memory MCP server):
- Vector embeddings of session content
- Semantic similarity search
- Hybrid BM25 + vector retrieval
- Automatic contextual injection

## Dependencies

| Dependency | Required | Notes |
|-----------|----------|-------|
| bash 4+ | Yes | For `${var,,}` case conversion |
| jq | Recommended | Fallback mode works without it, but limited |
| Claude Code hooks | Yes | PreToolUse, PostToolUse, PostToolUseFailure, SessionStart, SessionEnd |

## Settings Integration

The `install` verb merges these hooks into `.claude/settings.local.json`:

```json
{
  "hooks": {
    "PreToolUse": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-tool-use.sh pre"}]}],
    "PostToolUse": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-tool-use.sh post"}]}],
    "PostToolUseFailure": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-tool-use.sh failure"}]}],
    "SessionStart": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-session.sh start"}]}],
    "SessionEnd": [{"hooks": [{"type": "command", "command": ".claude/auditlog/hooks/on-session.sh end"}]}]
  }
}
```

## Skill Integration

The `/auditlog` skill (`.claude/skills/auditlog/SKILL.md`) exposes all CLI verbs to Claude.

## Verification Plan

1. `auditlog check` — verify jq, hook scripts, no hooks registered yet
2. `auditlog install` — register hooks
3. `auditlog check` — verify hooks now registered
4. Use Claude Code normally (trigger some tool calls)
5. `auditlog status` — confirm logs are being created
6. `auditlog list` — see sessions
7. `auditlog search "Bash"` — find tool calls
8. `auditlog stats` — see tool breakdown
9. `auditlog export --FORMAT text` — human-readable export
10. `auditlog clean --DAYS 0 --FORCE` — clean all logs
11. `auditlog uninstall` — remove hooks
