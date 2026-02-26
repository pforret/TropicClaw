# Gap Analysis: Channels (Messaging Adapters)

## OpenClaw Feature

Channels are pluggable messaging adapters that connect the agent to external platforms:

- **Supported platforms**: WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Teams, SMS, Email
- **Unified message format**: Normalize incoming/outgoing messages across all channels
- **Allowlist verification**: Only respond to authorized users/groups
- **Command detection**: Recognize `/commands` and route to appropriate handlers
- **Media staging**: Handle images, audio, video, documents across platforms
- **Channel lifecycle**: Connect, disconnect, reconnect with backoff

## Claude Code Coverage

| Feature                | Status  | Claude Code Primitive                                        |
|------------------------|---------|--------------------------------------------------------------|
| Slack integration      | Partial | MCP server available (`@anthropic/slack-mcp`)                |
| Web/mobile access      | Partial | [Remote Control](https://code.claude.com/docs/en/remote-control) — claude.ai/code + Claude iOS/Android app as interaction surfaces |
| Other channels         | No      | —                                                            |
| Unified message format | No      | —                                                            |
| Allowlist verification | No      | —                                                            |
| Command detection      | Partial | Skills system detects `/command` patterns                    |
| Media handling         | Partial | Can read images, create files, but no media staging pipeline |
| Channel lifecycle      | No      | —                                                            |

**What works:**
- Slack MCP server exists in the MCP registry, providing basic Slack read/write
- **Remote Control** (`claude remote-control`) exposes a local session to claude.ai/code web UI and Claude mobile app (iOS/Android). The session runs locally with full MCP/tool access; Anthropic's API acts as relay (outbound HTTPS polling, no inbound ports). One remote session at a time, Max plan only.
- Skills system provides `/command` detection within Claude Code sessions
- File tools can read images and create media files locally

## Gaps

| Gap                                         | Severity | Notes                                             |
|---------------------------------------------|----------|---------------------------------------------------|
| No WhatsApp adapter                         | HIGH     | Most common personal messaging platform           |
| No Telegram adapter                         | HIGH     | Popular for bot integrations                      |
| No Discord adapter                          | MEDIUM   | Common for community/team use                     |
| No Signal/iMessage/Teams/SMS/Email adapters | MEDIUM   | Needed for full coverage                          |
| No unified message format                   | HIGH     | Each channel has different payload structures     |
| No allowlist/mention gating                 | HIGH     | Security-critical for multi-channel deployment    |
| No media normalization pipeline             | MEDIUM   | Different platforms have different media APIs     |
| No channel lifecycle management             | HIGH     | No reconnect logic, health monitoring per channel |
| Remote Control is human-only               | MEDIUM   | No programmatic API — external bots/services cannot send messages to a session |
| Remote Control: one session at a time      | LOW      | Cannot serve multiple channels concurrently via Remote Control |

## Build Recommendations

1. **MCP servers per channel** — Build each adapter as an MCP server:
   - `whatsapp-mcp` (via WhatsApp Business API or Baileys)
   - `telegram-mcp` (via Bot API)
   - `discord-mcp` (via Discord.js)
   - `signal-mcp` (via Signal CLI or libsignal)
   - Additional adapters as needed
2. **Message normalization layer** — Define a unified `Message` schema and convert to/from each platform's format in the MCP server
3. **Allowlist as configuration** — Store authorized users/groups in settings or a config file; check in each adapter's MCP server before forwarding to agent
4. **Media staging service** — A shared MCP tool or local service that downloads, converts, and stages media files for the agent
5. **Leverage existing libraries** — Use mature SDKs (Baileys for WhatsApp, python-telegram-bot, discord.js) inside MCP servers
6. **Adopt Remote Control's relay pattern** — Channel adapters could use the same outbound-polling architecture (no inbound ports) to bridge external platforms to Claude Code sessions

## Verdict

**RED** — Apart from a basic Slack MCP server, virtually all channel adapters, the unified message format, allowlist gating, and channel lifecycle management must be built from scratch. This is the largest build effort across all subsystems.
