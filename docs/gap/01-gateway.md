# Gap Analysis: Gateway (Control Plane)

## OpenClaw Feature

The Gateway is OpenClaw's central orchestration layer — a **long-running daemon** that you start once and it sits there:

- **Persistent connections** to Telegram, WhatsApp, Discord, Slack — maintained continuously
- **WebSocket/JSON-RPC 2.0** API on port 18789 for real-time agent communication and external integrations
- **OpenAI-compatible endpoint** on the same API — any tool that speaks the OpenAI API can connect
- **HTTP webhooks** for receiving channel events (message received, button clicked, etc.)
- **Cron scheduling** for periodic tasks (reminders, health checks, data sync)
- **Health checks** and monitoring endpoints
- **Config resolution** across environments and agents
- Subsystem lifecycle management (start/stop/restart channel adapters as child processes)

### Message → Response Flow

When a message arrives (e.g., from Telegram):

1. Gateway receives event via persistent channel connection
2. Checks config: **which agent handles this?** (channel mapping in `config.json`)
3. Determines SessionId: continuation of existing conversation or new session?
4. Assembles context: reads session history from `.jsonl` file, pulls bootstrap workspace files, adds available skills
5. Sends assembled context + message to the LLM
6. LLM returns text or tool call. If tool call → Gateway executes it → feeds result back → LLM thinks further → loop until final answer
7. Response streams back to channel. Exchange written to `.jsonl`. `sessions.json` updated.

### Security Model

- **Localhost-only by default** — Gateway only listens on 127.0.0.1
- **Remote access**: VPN via Tailscale or SSH tunnel
- **Warning**: Exposing port 18789 to the open internet = full access to all agents, sessions, workspace files, and tools

## Claude Code Coverage

| Feature               | Status  | Claude Code Primitive                                                         |
|-----------------------|---------|-------------------------------------------------------------------------------|
| Config resolution     | Partial | Settings hierarchy (global → project → local), `CLAUDE.md` files              |
| Lifecycle events      | Partial | Hooks: `PreToolUse`, `PostToolUse`, `Notification`, `Stop`                    |
| Session start/end     | Partial | Hooks: session-level events                                                   |
| CLI invocation        | Yes     | `claude` CLI with `-p` for non-interactive, `--resume` for session continuity |
| Persistent session    | Partial | [Remote Control](https://code.claude.com/docs/en/remote-control) keeps a local session alive, accessible via web/mobile |
| Message relay         | Partial | Remote Control uses outbound HTTPS polling through Anthropic API as relay     |
| Process orchestration | No      | —                                                                             |

**What works:**
- Settings hierarchy (`~/.claude/settings.json` → project → `.claude/settings.local.json`) provides layered config
- Hooks fire on tool use, notifications, and session events — useful for side-effects
- CLI can be invoked programmatically (`claude -p "prompt"`) enabling wrapper scripts
- **Remote Control** (`claude remote-control`) keeps a local session running as a quasi-daemon, accessible from claude.ai/code and Claude mobile app. Uses outbound HTTPS polling (no inbound ports); Anthropic API acts as message relay. Limitations: human-operated only (no programmatic API), one session at a time, Max plan required

## Gaps

| Gap                               | Severity | Notes                                                            |
|-----------------------------------|----------|------------------------------------------------------------------|
| No long-lived server/daemon mode  | ~~HIGH~~ → **DESIGNED** | Gateway PRP: Bun/Fastify long-running daemon, managed by launchd/systemd |
| No WebSocket/JSON-RPC endpoint    | ~~HIGH~~ → **DESIGNED** | Gateway PRP: Fastify HTTP server on port 18789 with REST API endpoints |
| No HTTP webhook listener          | ~~HIGH~~ → **DESIGNED** | Gateway PRP: `/api/message`, `/api/deliver`, `/health`, `/api/sessions` |
| No cron/scheduler                 | ~~MEDIUM~~ → **ADDRESSED** | Tropicron: bash-based cron matching, job store, precheck, `/tropicron` skill |
| No health check endpoint          | ~~MEDIUM~~ → **DESIGNED** | Gateway PRP: `GET /health` returns uptime, active sessions, queue depth |
| No subsystem lifecycle management | ~~HIGH~~ → **DESIGNED** | Gateway PRP: channel adapters started/stopped by gateway; agent pool with concurrency control |

## Gateway PRP Design

The [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md) defines a Bun/Fastify orchestration layer that addresses all HIGH gaps. Key design decisions:

- **Runtime:** Bun (fast startup, native TypeScript, built-in SQLite via `bun:sqlite`, `.env` loading)
- **HTTP framework:** Fastify (schema-validated routes, better performance than Express)
- **Invocation:** CLI-only via `claude -p` — gets MCP servers, hooks, skills, and built-in tools for free; ~2-3s spawn overhead acceptable for messaging
- **State:** SQLite at `gateway/data/sessions.db` (sessions, messages, channel_agents tables)
- **Process management:** launchd (macOS) / systemd (Linux) for auto-restart
- **Security:** Localhost-only by default; owner verification per platform ID; fail-closed

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/message` | POST | Receive message from HTTP adapter |
| `/api/deliver` | POST | Deliver tropicron output to a channel |
| `/api/sessions/:agent/history` | GET | Load agent's message history |
| `/api/sessions/:agent/log` | POST | Append message to agent's session |
| `/api/sessions` | GET | List all sessions |
| `/api/agents` | GET | List available agents |
| `/health` | GET | Health check (uptime, sessions, queue) |

### Process Architecture

```
launchd/systemd
  └── gateway (Bun, long-running)
        ├── Fastify HTTP server (:18789)
        ├── Channel adapters (Telegram, Slack, Discord)
        ├── Agent pool (spawns claude -p, concurrency limit: 3)
        └── Session store (SQLite)

crontab (every minute, independent)
  └── tropicron run → spawns claude -p for scheduled jobs
```

### Implementation Phases

1. **Phase 1:** Scaffold + HTTP adapter + agent pool + session store + router (testable without external accounts)
2. **Phase 2:** Telegram adapter (long-polling via Telegraf)
3. **Phase 3:** Dreaming (nightly session maintenance) + Slack adapter
4. **Phase 4:** Trust enforcer hook, Discord adapter, media pipeline, process management

## Verdict

**YELLOW → GREEN (pending implementation)** — All gateway gaps are fully designed in the [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md). Tropicron already addresses scheduling. The verdict upgrades to GREEN once the gateway is implemented.
