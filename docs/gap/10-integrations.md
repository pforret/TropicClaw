# Gap Analysis: External App Integrations

## OpenClaw Feature

OpenClaw's [integrations page](https://openclaw.ai/integrations) lists 50+ native integrations across 8 categories beyond messaging channels (covered in [02-channels.md](02-channels.md)) and AI models (not applicable — Claude Code *is* the runtime).

### Productivity & Knowledge
| App | What it does |
|-----|-------------|
| Apple Notes | Native macOS/iOS note management |
| Apple Reminders | Task management for Apple devices |
| Things 3 | GTD task manager |
| Notion | Workspace and database management |
| Obsidian | Knowledge graph note-taking |
| Bear Notes | Markdown note application |
| Trello | Kanban board collaboration |
| GitHub | Code, issues, PR management |

### Email & Communication
| App | What it does |
|-----|-------------|
| Gmail | Pub/Sub email trigger automation |
| Email (generic) | Send and read email |

### Music & Audio
| App | What it does |
|-----|-------------|
| Spotify | Music playback control |
| Sonos | Multi-room audio control |
| Shazam | Song identification |

### Smart Home
| App | What it does |
|-----|-------------|
| Philips Hue | Smart light control |
| 8Sleep | Connected mattress control |
| Home Assistant | Central home automation hub |

### Social Media
| App | What it does |
|-----|-------------|
| Twitter/X | Tweet, reply, search |

### Security
| App | What it does |
|-----|-------------|
| 1Password | Secure credential management |

### Media & Creative
| App | What it does |
|-----|-------------|
| Image Gen | AI image creation |
| GIF Search | Animated GIF search |
| Peekaboo | Screen capture & control |
| Camera | Photo/video capture |

### Tools & Automation
| App | What it does |
|-----|-------------|
| Browser | Chrome remote control |
| Canvas | Visual workspace with A2UI |
| Voice | Voice wake-up and talk mode |
| Cron | Scheduled tasks |
| Webhooks | External event triggers |
| Weather | Forecasts and conditions |

## Claude Code Coverage

| Category | Status | Claude Code Primitive |
|----------|--------|----------------------|
| GitHub | **Yes** | `gh` CLI, GitHub MCP server |
| Browser | **Yes** | Claude in Chrome, Playwright MCP, dev-browser skill |
| Image Gen | **Yes** | Document-skills (canvas-design, algorithmic-art) |
| Screen Capture | **Yes** | Peekaboo-like via screenshot skills, Computer Use |
| Cron | **Yes** | Tropicron self-scheduling |
| 1Password | **Partial** | Official 1Password MCP server exists (not installed) |
| Notion | **Partial** | Community Notion MCP server exists (not installed) |
| Spotify | **Partial** | Community Spotify MCP server exists (not installed) |
| Gmail | **Partial** | Community Gmail MCP servers exist (not installed) |
| Home Assistant | **Partial** | Community HA MCP server exists (not installed) |
| Obsidian | **Partial** | Community Obsidian MCP server exists (not installed) |
| Twitter/X | **Partial** | Community Twitter MCP servers exist (not installed) |
| Weather | **Partial** | Community weather MCP servers exist (not installed) |
| Webhooks | **Partial** | Gateway HTTP adapter handles inbound; no outbound webhook subscriptions |
| Apple Notes/Reminders | **No** | No MCP server known |
| Things 3 | **No** | No MCP server known |
| Bear Notes | **No** | No MCP server known |
| Trello | **No** | No MCP server known |
| Sonos | **No** | No MCP server known |
| 8Sleep | **No** | No MCP server known |
| Shazam | **No** | No MCP server known |
| Voice | **No** | No voice wake/talk mode |
| Canvas/A2UI | **No** | See [09-web-app-generation.md](09-web-app-generation.md) |

## Architecture Difference

OpenClaw builds integrations as **native adapters** compiled into its runtime. Claude Code uses **MCP servers** as the plug-in mechanism — each integration is a separate process exposing tools via the Model Context Protocol.

This means Claude Code doesn't need to *build* most integrations. The MCP ecosystem already provides many of them. The real gaps are structural:

### Structural Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| No integration registry/catalog | **MEDIUM** | No curated list of tested, compatible MCP servers for TropicClaw |
| No auto-provisioning | **MEDIUM** | Each MCP server must be manually `claude mcp add`'d with correct args |
| No unified credential management | **HIGH** | OpenClaw uses 1Password; Claude Code has no secrets store — each MCP server manages its own auth |
| No event-driven triggers | **HIGH** | Gmail Pub/Sub, webhook subscriptions → agent activation is not native. Tropicron covers cron-based polling only |
| No voice interface | **MEDIUM** | No wake word, no speech-to-text/text-to-speech pipeline |

### Per-Category Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| Apple ecosystem (Notes, Reminders) | **LOW** | AppleScript-based MCP server could be built; niche use case |
| Things 3 / Bear Notes | **LOW** | AppleScript/URL scheme bridges possible; niche |
| Trello | **LOW** | REST API; community MCP likely exists or is trivial to build |
| Sonos / 8Sleep / Shazam | **LOW** | IoT/audio; very niche for a CLI agent |
| Voice wake + talk mode | **MEDIUM** | Requires always-on audio pipeline; fundamentally different from CLI interaction |

## Build Recommendations

### 1. Curated MCP Registry (Priority: HIGH)

Create `docs/integrations/` with a tested catalog of MCP servers:

```
docs/integrations/
├── index.md              # Master list with install commands
├── productivity.md       # Notion, Obsidian, Trello, GitHub
├── email.md              # Gmail
├── smart-home.md         # Home Assistant, Hue
├── music.md              # Spotify
├── social.md             # Twitter/X
└── security.md           # 1Password
```

Each entry should include: MCP server repo, install command, required env vars, tested features, known limitations.

### 2. Integration Setup Skill (Priority: MEDIUM)

A `/setup-integration` skill that:
- Lists available integrations
- Runs `claude mcp add` with correct arguments
- Prompts for credentials/API keys
- Verifies the connection works

### 3. Credential Management (Priority: HIGH)

Options:
- **1Password MCP** — use 1Password as the secrets backend (aligns with OpenClaw)
- **Environment file** — `.env` with `dotenv` loading per MCP server
- **macOS Keychain** — `security` CLI for local credential storage

### 4. Event-Driven Activation (Priority: MEDIUM)

Extend tropicron or build a companion service for:
- Polling-based triggers: check Gmail/webhooks on a schedule, invoke agent on new items
- Webhook receiver: add webhook endpoint to gateway HTTP adapter
- File-watch triggers: monitor local directories for new files

### 5. Apple Ecosystem Bridge (Priority: LOW)

If needed, a single `apple-mcp` server using AppleScript/Shortcuts to bridge Notes, Reminders, Calendar, and other macOS apps.

## Verdict

**YELLOW — architecture exists, curation needed.** Claude Code's MCP protocol is the correct extension mechanism and community MCP servers already exist for most high-value integrations (Gmail, Notion, Spotify, Home Assistant, 1Password, Twitter). The gaps are not in capability but in **discoverability** (no registry), **provisioning** (manual setup), **credentials** (no unified secrets), and **event-driven activation** (polling only). The niche Apple/IoT/voice gaps are low priority for a CLI-first agent.
