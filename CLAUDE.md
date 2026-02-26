# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

TropicClaw investigates what features, plugins, and technologies are needed to build an [OpenClaw](https://github.com/pforret/clarabot/blob/main/docs/AI-assistant/OPENCLAW_ARCHITECTURE.md)-like personal AI assistant platform on top of Claude Code's existing capabilities.

**OpenClaw** unifies multiple messaging channels (WhatsApp, Telegram, Discord, Slack, Signal, etc.) under a single agentic runtime with these subsystems:

1. **Gateway** — central orchestration via WebSocket/JSON-RPC 2.0, HTTP webhooks, cron, health checks
2. **Channels** — pluggable messaging adapters with allowlist verification, command detection, media staging
3. **Agent Runtime** — multi-turn conversations, append-only session logs, dynamic system prompts, multi-agent with separate personas/tools
4. **Tools & Skills** — shell, browser automation, canvas, messaging, camera, location; installable skill packages with per-agent allow/deny lists
5. **Memory** — semantic search via vector embeddings, hybrid BM25 + vector similarity, scoped filtering

## Research Focus

For each OpenClaw subsystem, determine what Claude Code already provides natively (MCP servers, hooks, skills, tools) vs. what requires custom development:

- **Gap analysis**: which OpenClaw features map to existing Claude Code primitives?
- **MCP servers**: which channel adapters or tool integrations can be built as MCP servers?
- **Hooks**: which lifecycle events can leverage Claude Code's hook system?
- **Skills**: which OpenClaw skills already exist as Claude Code skills or document-skills?
- **Missing pieces**: what requires building from scratch (gateway, channel adapters, memory subsystem)?

## Key Reference

- OpenClaw architecture doc: `docs/AI-assistant/OPENCLAW_ARCHITECTURE.md` (in [clarabot repo](https://github.com/pforret/clarabot))
- Claude Code docs: slash commands, MCP protocol, hooks, skills, settings
