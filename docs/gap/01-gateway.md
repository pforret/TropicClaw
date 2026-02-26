# Gap Analysis: Gateway (Control Plane)

## OpenClaw Feature

The Gateway is OpenClaw's central orchestration layer:

- **WebSocket/JSON-RPC 2.0** server for real-time agent communication
- **HTTP webhooks** for receiving channel events (message received, button clicked, etc.)
- **Cron scheduling** for periodic tasks (reminders, health checks, data sync)
- **Health checks** and monitoring endpoints
- **Config resolution** across environments and agents
- Persistent daemon process managing all subsystem lifecycles

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
| No long-lived server/daemon mode  | HIGH     | Remote Control partially addresses this (keeps session alive) but is human-only, one session, Max plan |
| No WebSocket/JSON-RPC endpoint    | HIGH     | Cannot receive real-time events from channels                    |
| No HTTP webhook listener          | HIGH     | Cannot natively host HTTP endpoints                              |
| No cron/scheduler                 | MEDIUM   | Must rely on OS cron or external scheduler calling `claude -p`   |
| No health check endpoint          | MEDIUM   | No built-in monitoring interface                                 |
| No subsystem lifecycle management | HIGH     | No way to start/stop/restart channel adapters as child processes |

## Build Recommendations

1. **External gateway process** — Build a Node.js or Python long-lived server that:
   - Hosts WebSocket + HTTP endpoints
   - Manages cron via `node-cron` or `APScheduler`
   - Spawns `claude -p` or uses the Claude API for agent interactions
2. **MCP server for gateway control** — Expose gateway state (active channels, queue depth, health) as MCP tools so Claude can inspect/manage the gateway
3. **Hooks as integration points** — Use `PostToolUse` hooks to emit events to the gateway (e.g., notify when a task completes)
4. **Systemd/launchd** for process management — Run the gateway as a proper system service

## Verdict

**YELLOW** — Claude Code provides config resolution and lifecycle hooks, but lacks the persistent server process that is the Gateway's core function. A custom orchestration layer must be built, with Claude Code invoked as the agent runtime underneath.
