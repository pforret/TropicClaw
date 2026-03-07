# TropicClaw

**Can Claude Code become a personal AI assistant platform?**

TropicClaw investigates what it takes to build an [OpenClaw](https://github.com/pforret/clarabot/blob/main/docs/AI-assistant/OPENCLAW_ARCHITECTURE.md)-like multi-channel AI assistant on top of Claude Code's existing capabilities — skills, hooks, MCP servers, and plugins.

## The question

[OpenClaw](https://github.com/pforret/clarabot/blob/main/docs/AI-assistant/OPENCLAW_ARCHITECTURE.md) is an architecture for a personal AI assistant that unifies multiple messaging channels (WhatsApp, Telegram, Discord, Slack, Signal, etc.) under a single agentic runtime. It has five subsystems:

1. **Gateway** — central orchestration, WebSocket/HTTP endpoints, cron scheduling
2. **Channels** — pluggable adapters per messaging platform
3. **Agent Runtime** — multi-turn conversations, multi-agent personas, dynamic system prompts
4. **Tools & Skills** — shell, browser, canvas, messaging, camera, location
5. **Memory** — semantic search via vector embeddings, hybrid retrieval

Claude Code already provides many of these capabilities natively. TropicClaw maps each OpenClaw subsystem against Claude Code to find the gaps.

## What's in this site

### [Gap Analysis](gap/index.md)

Subsystem-by-subsystem comparison of OpenClaw vs Claude Code. Each page covers what Claude Code provides, what's missing, and how to build the missing pieces.

| # | Subsystem                                          | Verdict                                                                       |
|---|----------------------------------------------------|--------------------------------------------------------------------|
| 1 | [Gateway](gap/01-gateway.md)                       | 🟢 **GREEN** (pending) — fully designed in [Gateway PRP](todo/PRPs/2026-03-07-gateway.md) |
| 2 | [Channels](gap/02-channels.md)                     | 🔴 **RED** — only Slack MCP; Telegram/Slack/Discord designed in Gateway PRP |
| 3 | [Agent Runtime](gap/03-agent-runtime.md)           | 🟢 **GREEN** (pending) — all gaps designed in Gateway PRP         |
| 4 | [Tools & Skills](gap/04-tools-skills.md)           | 🟢 **GREEN/YELLOW** — most tools exist natively                   |
| 5 | [Memory](gap/05-memory.md)                         | 🟡 **YELLOW** — claude-mem + claude-memory-mcp installed; scoped filtering missing |
| 6 | [Self-Scheduling](gap/06-self-scheduling.md)       | 🟢 **GREEN** — tropicron: cron, job store, precheck, memory, skill |
| 7 | [Persona Templates](gap/07-persona-templates.md)   | 🟢 **GREEN/YELLOW** — claude-memory-mcp identity anchors          |
| 8 | [Autonomy & Trust](gap/08-autonomy-trust.md)       | 🟢 **GREEN** (pending) — trust tiers 0–3 designed in Gateway PRP  |
| 9 | [Web App Generation](gap/09-web-app-generation.md) | 🟠 **YELLOW/RED** — can build apps, but no Canvas/A2UI           |

### [Extending Claude Code](extend/index.md)

Reference on how Claude Code can be extended via bash scripts, skills, hooks, MCP servers, and plugins — the building blocks for bridging the gaps above.

## Key findings

**What Claude Code already provides** (no custom development needed):

- Multi-turn conversation with context management
- System prompt layering via `CLAUDE.md`
- Tool execution (shell, files, web, notebooks)
- Skill + plugin installation and management
- MCP server integration
- Hook-based lifecycle automation
- Remote Control (web/mobile access to local sessions)

**What has been built:**

- 🟢 Self-scheduling — tropicron (cron matching, job store, precheck, per-job memory)
- 🟢 Audit logging — tropiclog (hook-based JSON-lines)
- 🟢 Memory — claude-mem (Chroma vectors + FTS5) + claude-memory-mcp (identity)

**What must be built:**

- 🚧 Gateway/orchestrator — [PRP written](todo/PRPs/2026-03-07-gateway.md) (Bun/Fastify, agent pool, sessions, trust)
- 🚧 Channel adapters — designed in Gateway PRP (Telegram, Slack, Discord)
- ❌ Canvas/live rendering — no equivalent to OpenClaw's A2UI

## Links

- [OpenClaw architecture](https://github.com/pforret/clarabot/blob/main/docs/AI-assistant/OPENCLAW_ARCHITECTURE.md) — the target architecture
- [Claude Code docs](https://code.claude.com/docs/en/features-overview) — extension layer reference
- [TropicClaw repo](https://github.com/pforret/TropicClaw) — this project

 
<!-- test Sat Mar  7 16:01:35 CET 2026 -->
<!-- test2 Sat Mar  7 16:02:11 CET 2026 -->
<!-- standalone test Sat Mar  7 16:02:26 CET 2026 -->
<!-- livereload test Sat Mar  7 16:06:45 CET 2026 -->
