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

| # | Subsystem | Verdict |
|---|-----------|---------|
| 1 | [Gateway](gap/01-gateway.md) | **YELLOW** — hooks + CLI work, but no persistent daemon |
| 2 | [Channels](gap/02-channels.md) | **RED** — only Slack MCP + Remote Control; rest must be built |
| 3 | [Agent Runtime](gap/03-agent-runtime.md) | **YELLOW** — multi-turn works; no multi-agent orchestration |
| 4 | [Tools & Skills](gap/04-tools-skills.md) | **GREEN/YELLOW** — most tools exist natively |
| 5 | [Memory](gap/05-memory.md) | **RED** — no vector/semantic search |
| 6 | [Self-Scheduling](gap/06-self-scheduling.md) | **RED** — no scheduler; agent can't manage its own jobs |
| 7 | [Persona Templates](gap/07-persona-templates.md) | **YELLOW** — CLAUDE.md covers it, but unstructured |
| 8 | [Web App Generation](gap/08-web-app-generation.md) | **YELLOW/RED** — can build apps, but no Canvas/A2UI live rendering |

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

**What must be built:**

- Memory MCP server (embeddings + vector DB)
- Channel adapters (Telegram, WhatsApp, Discord, etc.)
- Gateway/orchestrator (persistent daemon with WebSocket + HTTP)
- Self-scheduling MCP server (agent-managed cron)

## Links

- [OpenClaw architecture](https://github.com/pforret/clarabot/blob/main/docs/AI-assistant/OPENCLAW_ARCHITECTURE.md) — the target architecture
- [Claude Code docs](https://code.claude.com/docs/en/features-overview) — extension layer reference
- [TropicClaw repo](https://github.com/pforret/TropicClaw) — this project
