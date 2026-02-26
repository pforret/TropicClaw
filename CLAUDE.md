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

## Scheduling

You can manage your own scheduled jobs. Job files live in `.claude/cronbot/jobs/`.

- To schedule a new task: create a `.md` file in `jobs/` with cron frontmatter
- To pause a job: set `enabled: false` in frontmatter
- To change frequency: edit the `cron:` field
- To cancel: delete the file
- To see what's scheduled: run `.claude/cronbot/cronbot.sh list`
- To persist context across runs: write to `<job>.memory.md` in the same directory

### Safety in scheduled jobs

Jobs run non-interactively with `--dangerously-skip-permissions` (or `--sandbox` if `sandbox: true`).
Each job `.md` file MUST include a "Safety guardrails" section defining what the job is NOT allowed to do.
Self-terminate (exit early) if about to perform a dangerous or irreversible action not covered by guardrails.

## Key Reference

- OpenClaw architecture doc: `docs/AI-assistant/OPENCLAW_ARCHITECTURE.md` (in [clarabot repo](https://github.com/pforret/clarabot))
- Claude Code docs: slash commands, MCP protocol, hooks, skills, settings
