# OpenClaw → Claude Code Gap Analysis

This directory maps each OpenClaw subsystem against Claude Code's native capabilities to identify what exists, what partially exists, and what must be built.

## Summary Matrix

| # | Subsystem                                      | Verdict              | Key Claude Code Primitives                                    | Biggest Gap                                                    |
|---|------------------------------------------------|----------------------|---------------------------------------------------------------|----------------------------------------------------------------|
| 1 | [Gateway](01-gateway.md)                       | **YELLOW**           | Hooks, Settings hierarchy, CLI `-p`, Remote Control           | No programmatic gateway ([PRP written](../todo/PRPs/2026-03-07-gateway.md)) |
| 2 | [Channels](02-channels.md)                     | **RED**              | Slack MCP, Remote Control (web/mobile)                        | No adapters for WhatsApp, Telegram, Discord, etc. (Gateway PRP covers Telegram, Slack, Discord) |
| 3 | [Agent Runtime](03-agent-runtime.md)           | **GREEN** (pending)  | Multi-turn, `CLAUDE.md`, Skills fork, `allowed-tools`, tropiclog | All gaps designed in Gateway PRP; awaiting implementation      |
| 4 | [Tools & Skills](04-tools-skills.md)           | **GREEN/YELLOW**     | Bash, file tools, WebSearch, Skills, MCP                      | No camera/location, limited sandboxing                         |
| 5 | [Memory](05-memory.md)                         | **YELLOW**           | `CLAUDE.md`, auto-memory, claude-mem, claude-memory-mcp       | Scoped filtering, lifecycle management                         |
| 6 | [Self-Scheduling](06-self-scheduling.md)       | **GREEN**            | Tropicron: cron matching, job store, precheck, memory, skill  | No retry/backoff (minor)                                       |
| 7 | [Persona Templates](07-persona-templates.md)   | **GREEN/YELLOW**     | `CLAUDE.md`, claude-memory-mcp identity anchors               | No structured user model, no device registry                   |
| 8 | [Autonomy & Trust](08-autonomy-trust.md)       | **GREEN** (pending)  | `allowed-tools`, trust-enforcer hook, tropiclog audit trail   | Implement `trust-enforcer.sh` hook (designed in Gateway PRP)   |
| 9 | [Web App Generation](09-web-app-generation.md) | **YELLOW/RED**       | Full-stack app generation, Bash dev servers, Claude in Chrome  | No Canvas/A2UI live rendering surface                          |

## Build Priority

Based on gap severity and dependency order:

1. **Gateway + channel adapters** — [PRP written](../todo/PRPs/2026-03-07-gateway.md). Bun/Fastify orchestrator with Telegram (Phase 1), Slack (Phase 3), Discord (Phase 4). Addresses gateway, channels, agent runtime, trust tiers.
2. **Memory improvements** (YELLOW) — claude-mem and claude-memory-mcp installed; remaining: scoped filtering, lifecycle management
3. **Canvas/live rendering** (YELLOW/RED) — No equivalent to OpenClaw's Canvas; lowest priority since Claude Code excels at full-stack generation
4. **Tool extensions** (GREEN/YELLOW) — Most tools already exist; camera/location are niche gaps

## What Claude Code Already Provides

These capabilities require **no custom development**:

- Multi-turn conversation with context management
- System prompt layering via `CLAUDE.md`
- Tool execution (shell, files, web, notebooks)
- Skill installation and management
- MCP server integration
- Tool permission control (`allowed-tools`)
- Session resume/continue
- Hook-based lifecycle events
- Basic persistent memory (auto-memory files)
- Remote Control — persistent local session accessible from web/mobile (human-operated, outbound-polling relay)

## What Has Been Built

| Component                       | Type                   | Status                                         |
|---------------------------------|------------------------|-------------------------------------------------|
| Self-scheduling (tropicron)     | Bash scheduler + skill | ✅ Done — cron matching, job store, precheck, memory, `/tropicron` skill |
| Append-only audit logs          | Hook + CLI             | ✅ Done — tropiclog hook-based JSON-lines logging |
| Memory (semantic search)        | MCP server             | ✅ Installed — claude-mem (Chroma + FTS5) + claude-memory-mcp (identity) |
| Persona templates               | MCP server + files     | ✅ Partial — claude-memory-mcp identity anchors, SOUL.md/USER.md planned |

## What Must Be Built

| Component                       | Type                   | Status                                         |
|---------------------------------|------------------------|-------------------------------------------------|
| Gateway/orchestrator            | Bun/Fastify service    | 📋 [PRP written](../todo/PRPs/2026-03-07-gateway.md) — agent pool, routing, sessions, trust |
| Channel adapters                | Gateway adapters       | 📋 Designed in Gateway PRP — Telegram (Phase 2), Slack (Phase 3), Discord (Phase 4) |
| Agent registry & routing        | Gateway logic          | 📋 Designed — auto-discovery from `agents/*/CLAUDE.md`, `/switch` commands |
| Message normalization           | Gateway types          | 📋 Designed — `UnifiedMessage` schema in Gateway PRP |
| Trust tiers (0–3)               | Hook + gateway config  | 📋 Designed — `trust-enforcer.sh` PreToolUse hook |
| Canvas MCP server               | MCP server             | ❌ Not started — no equivalent to OpenClaw's Canvas/A2UI |
