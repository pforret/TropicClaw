# OpenClaw → Claude Code Gap Analysis

This directory maps each OpenClaw subsystem against Claude Code's native capabilities to identify what exists, what partially exists, and what must be built.

## Summary Matrix

| # | Subsystem                                | Verdict          | Key Claude Code Primitives                            | Biggest Gap                                            |
|---|------------------------------------------|------------------|-------------------------------------------------------|--------------------------------------------------------|
| 1 | [Gateway](01-gateway.md)                 | **YELLOW**       | Hooks, Settings hierarchy, CLI `-p`, Remote Control   | No programmatic gateway (Remote Control is human-only) |
| 2 | [Channels](02-channels.md)               | **RED**          | Slack MCP, Remote Control (web/mobile)                | No adapters for WhatsApp, Telegram, Discord, etc.      |
| 3 | [Agent Runtime](03-agent-runtime.md)     | **YELLOW**       | Multi-turn, `CLAUDE.md`, Skills fork, `allowed-tools` | No multi-agent orchestration (audit logs ✅ via `auditlog.sh`) |
| 4 | [Tools & Skills](04-tools-skills.md)     | **GREEN/YELLOW** | Bash, file tools, WebSearch, Skills, MCP              | No camera/location, limited sandboxing                 |
| 5 | [Memory](05-memory.md)                   | **RED**          | `CLAUDE.md`, auto-memory files                        | No vector/semantic search                              |
| 6 | [Self-Scheduling](06-self-scheduling.md) | **RED**          | None                                                  | No scheduler; agent cannot manage its own jobs         |
| 7 | [Persona Templates](07-persona-templates.md) | **YELLOW** | `CLAUDE.md`, auto-memory, settings                    | No structured identity/user/tools schemas              |

## Build Priority

Based on gap severity and dependency order:

1. **Memory MCP server** (RED) — Foundational; other subsystems benefit from persistent, searchable memory
2. **Channel adapters** (RED) — Required for any multi-channel deployment; start with 1-2 channels (e.g., Telegram + Slack)
3. **Gateway process** (YELLOW) — Needed once multiple channels and agents must be orchestrated
4. **Agent routing & orchestration** (YELLOW) — Builds on gateway; enables multi-agent per-channel
5. **Tool extensions** (GREEN/YELLOW) — Lowest priority; most tools already exist

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

## What Must Be Built

| Component | Type | Estimated Complexity |
|-----------|------|---------------------|
| Memory MCP server | MCP server | High — embeddings, vector DB, hybrid search |
| Channel adapters (per platform) | MCP server each | Medium per adapter |
| Gateway/orchestrator | Standalone service | High — WebSocket, routing, cron, lifecycle |
| Agent registry & routing | Config + gateway logic | Medium |
| Append-only audit logs | Hook + log service | Low |
| Message normalization | Library/schema | Medium |
| Self-scheduling MCP server | MCP server | Medium — CRUD tools, job runner, durable store |
