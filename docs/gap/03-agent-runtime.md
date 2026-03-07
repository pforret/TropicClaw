# Gap Analysis: Agent Runtime

## OpenClaw Feature

The Agent Runtime manages conversation state and agent execution:

- **Multi-turn conversations** with context preservation
- **Append-only session logs** for auditability (`.jsonl` per session, `sessions.json` index)
- **Dynamic system prompts** that adapt based on context, channel, user
- **Multi-agent orchestration** — separate personas with distinct tools, running simultaneously
- **Agent-per-channel routing** — different agents handle different channels
- **Tool execution sandboxing** — agents can only use their allowed tools

### Multi-Agent Architecture

Each agent is a **separate folder** in `~/.openclaw/agents/`:

```
~/.openclaw/agents/
  work/         ← knows your stack and project
    workspace/  ← its own AGENTS.md, SOUL.md, USER.md, MEMORY.md
    sessions/   ← its own conversation history
  personal/     ← knows your habits and schedule
    workspace/
    sessions/
  monitor/      ← watches servers via heartbeat
    workspace/
    sessions/
```

**Channel mapping** lives in `config.json` — write to one Telegram chat, it goes to the work agent; write to another, it goes to personal. Same Gateway, routing by rules.

### Session Isolation (dmScope)

`dmScope` controls how conversations are isolated:

| Setting | Behavior | Use case |
|---------|----------|----------|
| `"main"` | All DMs in a channel collapse into one session | Single-user, single-channel (default — **dangerous with multiple users**) |
| `"per-agent"` | Each agent sees only its own dialogues | Multi-agent setups where agents shouldn't cross-read |
| `"per-channel-peer"` | Each user gets their own session per channel | **Required** when multiple people access the same agent |

**Critical mistake**: `dmScope: "main"` with multiple users means the agent responds to one person with information from another's conversation. This is the default and must be changed manually.

## Claude Code Coverage

| Feature                  | Status  | Claude Code Primitive                                           |
|--------------------------|---------|-----------------------------------------------------------------|
| Multi-turn conversations | Yes     | Native — context window with auto-compression                   |
| System prompts           | Yes     | `CLAUDE.md` files (global, project, local)                      |
| Dynamic system prompts   | Partial | Can swap `CLAUDE.md` content, but not mid-session               |
| Sub-agent spawning       | Yes     | Skills with `context: fork`, Task tool                          |
| Tool execution           | Yes     | Built-in tools (Bash, Read, Edit, Write, Glob, Grep, etc.)      |
| Tool permissions         | Yes     | `allowed-tools` in settings, per-project                        |
| Session resume           | Yes     | `--resume` flag, `--continue` for last session                  |
| Session logs             | Yes     | Tropiclog hook-based JSON-lines logging (append-only)            |

**What works:**
- Claude Code's core is a capable multi-turn agent runtime
- `CLAUDE.md` provides layered system prompts (global → project → local)
- Skills with `context: fork` create sub-agents with isolated context
- `allowed-tools` restricts which tools an agent can use
- `--resume` enables session continuity across CLI invocations

## Gateway PRP Coverage

The [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md) defines a Bun/Fastify orchestration layer that addresses the remaining agent runtime gaps. Key design decisions:

### Multi-Agent Orchestration

- **Agent auto-discovery** — scan `gateway/agents/*/CLAUDE.md`; filesystem is the registry
- **Per-agent project directories** — each agent has its own `CLAUDE.md`, `agent.yaml`, `.claude/settings.json`
- **Agent pool** — spawns `claude -p` per message with concurrency limits (default: 3)
- **Agent switching** — `/switch <name>`, `/agents`, `/back`, `/new <name>` commands in any channel

### Session Model

- **One session per agent**, shared across all channels (session key = agent name)
- Cross-channel continuity: tell `main` something on Telegram, it knows on Slack
- Per-channel "current agent" pointer persisted in `channel_agents` SQLite table
- Session store in `gateway/data/sessions.db` (sessions + messages + channel_agents tables)

### Session Isolation

- **Single-user model** — no multi-user access, no `dmScope` needed
- Isolation is per-agent, not per-user: each agent has its own conversation history
- Owner verification: one platform ID per channel in `gateway.yaml`, fail-closed

### Trust Enforcement

- **Trust tiers** (0–3): read-only → local write → network → system
- `PreToolUse` hook (`trust-enforcer.sh`) enforces per-agent tier
- Trust tier set via `TRUST_TIER` env var when spawning `claude -p`

### Agent Registry

- Auto-discovered from `gateway/agents/*/CLAUDE.md`
- Per-agent config in `agent.yaml`: model, max_turns, trust_tier, timeout, description
- `/new <name> [desc]` scaffolds new agent directory (copy personality from existing or use template)

### Dreaming (Session Maintenance)

- Nightly tropicron job (3am) per agent
- Summarizes day's conversations, extracts learnings to memory plugins
- Evolves persona files (SOUL.md, USER.md, TOOLS.md)
- Compresses old messages (keep last 50 verbatim)
- Dream logs in `agents/<name>/dreams/YYYY-MM-DD.md`

## Remaining Gaps

| Gap                                | Severity | Notes                                                             |
|------------------------------------|----------|-------------------------------------------------------------------|
| No append-only session logs        | ~~MEDIUM~~ → **ADDRESSED** | Tropiclog — hook-based JSON-lines logging |
| No multi-agent orchestration       | ~~HIGH~~ → **DESIGNED** | Gateway PRP: agent pool with `claude -p`, per-agent directories, auto-discovery |
| No agent-per-channel routing       | ~~HIGH~~ → **DESIGNED** | Gateway PRP: per-channel current agent pointer, `/switch` commands, `channel_agents` table |
| No session isolation (dmScope)     | ~~HIGH~~ → **DESIGNED** | Gateway PRP: single-user model eliminates need; per-agent session isolation via separate directories |
| No dynamic system prompt switching | ~~MEDIUM~~ → **DESIGNED** | Gateway PRP: each agent has own `CLAUDE.md`; `/new` scaffolds with template; dreaming evolves persona files |
| No agent registry                  | ~~MEDIUM~~ → **DESIGNED** | Gateway PRP: auto-discovery from `agents/*/CLAUDE.md` + `agent.yaml` config |
| No conversation indexing           | ~~LOW~~ → **PARTIAL** | Keyword search via tropiclog; semantic search still requires Memory MCP |

## Build Recommendations

1. **Gateway implementation** — The [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md) covers multi-agent orchestration, channel routing, session management, trust enforcement, and agent lifecycle. Implementation in 4 phases: HTTP+agent pool → Telegram → dreaming+Slack → production hardening.
2. **Append-only logs via hooks** — ✅ Implemented as tropiclog (see [PRP](../todo/PRPs/done/2026-02-27-tropiclog.md)). Uses `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SessionStart`, `SessionEnd` hooks. CLI provides search, list, stats, export.
3. **Dreaming (session maintenance)** — Nightly tropicron job per agent: summarize conversations, extract learnings to memory plugins, evolve persona files, compress session history.

## Verdict

**YELLOW → GREEN (pending implementation)** — Claude Code provides a strong single-agent runtime. All major agent runtime gaps (multi-agent orchestration, channel routing, session isolation, agent registry, dynamic prompts) are now fully designed in the [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md). Tropiclog addresses audit logging. The verdict upgrades to GREEN once the gateway is implemented.
