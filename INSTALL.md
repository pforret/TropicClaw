# Installing TropicClaw

## Quick start

```bash
git clone https://github.com/pforret/TropicClaw.git
cd TropicClaw
cd gateway && bun install && cd ..
cp gateway/.env.example gateway/.env
./gateway.sh          # start the gateway
```

The gateway opens at `http://127.0.0.1:18789/`. That's it for a basic setup.
Read on for configuration, channels, scheduling, and more.

---

## Prerequisites

| Requirement | Version | Check | Install |
|-------------|---------|-------|---------|
| **Bun** | 1.0+ | `bun --version` | `curl -fsSL https://bun.sh/install \| bash` |
| **Claude Code** (CLI) | latest | `claude --version` | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code) |
| **Bash** | 4+ | `bash --version` | pre-installed on Linux/macOS |
| **Git** | any | `git --version` | pre-installed or via package manager |

### Optional

| Tool | Used by | Install |
|------|---------|---------|
| **mkdocs-material** | docs site | `pip install mkdocs-material mkdocs-awesome-pages-plugin` |
| **lynx** or **pandoc** | tropicron `url-changed.sh` | via package manager |
| **jq** | tropicron `url-changed.sh` | via package manager |

## Step-by-step setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/pforret/TropicClaw.git
cd TropicClaw
cd gateway && bun install && cd ..
```

This installs Fastify (HTTP server), grammY (Telegram), and other runtime dependencies.

### 2. Configure environment variables

```bash
cp gateway/.env.example gateway/.env
```

Edit `gateway/.env` and fill in what you need. All variables are optional — the gateway runs without any of them, but channel adapters need their tokens:

| Variable | When needed | Description |
|----------|-------------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram channel | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_OWNER_ID` | Telegram channel | Your Telegram numeric user ID (allowlist) |
| `TELEGRAM_CHANNEL_ID` | Bookmark publishing | Channel handle (e.g. `@mybookmarks`) |
| `TWITTER_API_KEY` | Bookmark publishing | Twitter/X API key |
| `TWITTER_API_SECRET` | Bookmark publishing | Twitter/X API secret |
| `TWITTER_ACCESS_TOKEN` | Bookmark publishing | Twitter/X access token |
| `TWITTER_ACCESS_SECRET` | Bookmark publishing | Twitter/X access secret |

### 3. Configure the gateway

Edit `gateway/config/gateway.yaml`:

```yaml
owner:
  telegram_id: "123456789"    # your Telegram user ID
  slack_id: ""                # future use
  discord_id: ""              # future use

port: 18789                   # HTTP port
host: "127.0.0.1"            # bind address
max_concurrent_agents: 3      # agent pool limit

bookmarks:
  enabled: true
  auto_detect_urls: true
  summary_model: haiku
```

### 4. Start the gateway

```bash
# From the repo root:
./gateway.sh              # production mode (quiet)
./gateway.sh dev          # development mode (verbose, auto-reload)
```

The gateway:
- Starts a Fastify HTTP server on port 18789
- Creates a SQLite database at `gateway/data/sessions.db` for session persistence
- Opens your browser to the web dashboard automatically
- Connects any configured channel adapters (Telegram, etc.)

**Verify it's running:**

```bash
curl http://127.0.0.1:18789/health
```

### 5. Set up agents (optional)

Agent configurations live in `gateway/agents/`. The default `main` agent is pre-configured. Each agent directory contains:

| File | Purpose |
|------|---------|
| `agent.yaml` | Model, trust tier, timeout, max turns |
| `CLAUDE.md` | System prompt and behavior rules |
| `SOUL.md` | Personality/persona definition (optional) |

To add a new agent:

```bash
mkdir gateway/agents/my-agent
# Copy and edit from the main agent as a template:
cp gateway/agents/main/agent.yaml gateway/agents/my-agent/
cp gateway/agents/main/CLAUDE.md  gateway/agents/my-agent/
```

### 6. Set up tropicron (optional)

tropicron is a cron-based scheduler that runs Claude Code sessions on a schedule.

```bash
# Install the crontab entry (checks every minute)
apps/tropicron/bin/tropicron.sh install

# Add an example job
apps/tropicron/bin/tropicron.sh add apps/tropicron/examples/health-check.md

# List all jobs
apps/tropicron/bin/tropicron.sh list

# Dry-run a job
apps/tropicron/bin/tropicron.sh test health-check
```

To enable the `/tropicron` slash command inside Claude Code:

```bash
cp -r apps/tropicron/skills/tropicron .claude/skills/
cp -r apps/tropicron/skills/tropicron-memory .claude/skills/
```

### 7. Serve the docs (optional)

```bash
pip install mkdocs-material mkdocs-awesome-pages-plugin
mkdocs serve
```

Opens at `http://127.0.0.1:8000/`.

## Project structure

```
TropicClaw/
├── gateway.sh                 # <-- START HERE: launches the gateway
├── INSTALL.md                 # This file
├── README.md                  # Project overview
├── CLAUDE.md                  # Instructions for Claude Code sessions
│
├── gateway/                   # Core gateway server
│   ├── package.json           # Bun dependencies (run bun install here)
│   ├── .env.example           # Environment variable template
│   ├── config/
│   │   └── gateway.yaml       # Gateway configuration
│   ├── data/                  # Runtime data (SQLite DB, gitignored)
│   ├── agents/
│   │   └── main/              # Default agent (CLAUDE.md, SOUL.md, agent.yaml)
│   ├── hooks/
│   │   └── trust-enforcer.sh  # PreToolUse trust tier enforcement
│   └── src/                   # TypeScript source (Bun runtime)
│       ├── index.ts           # Entry point
│       ├── router.ts          # HTTP routing
│       ├── agent-pool.ts      # Agent lifecycle
│       ├── session-store.ts   # SQLite session persistence
│       ├── web.ts             # Web dashboard routes
│       └── adapters/          # Channel adapters (Telegram, etc.)
│
├── apps/
│   ├── tropicron/             # Scheduled job runner
│   │   ├── bin/tropicron.sh   # Main scheduler script
│   │   ├── jobs/              # Job definition files (.md)
│   │   └── skills/            # Claude Code slash command skills
│   └── bookmarks/             # Bookmark management service
│
└── docs/                      # MkDocs documentation source
    ├── gap/                   # Gap analysis (OpenClaw vs Claude Code)
    └── extend/                # Claude Code extension reference
```

## Troubleshooting

**`SQLiteError: unable to open database file`**
The `gateway/data/` directory is missing. Create it:
```bash
mkdir -p gateway/data
```

**Gateway won't start**
Check that port 18789 isn't already in use:
```bash
lsof -i :18789
```

**`bun: command not found`**
Install Bun:
```bash
curl -fsSL https://bun.sh/install | bash
```

**`claude: command not found`**
Install Claude Code following [the official docs](https://docs.anthropic.com/en/docs/claude-code).

**Telegram bot not responding**
Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` in `gateway/.env`. The owner ID must be your numeric Telegram user ID (send `/start` to [@userinfobot](https://t.me/userinfobot) to find it).

**tropicron jobs not running**
```bash
apps/tropicron/bin/tropicron.sh check
```
This verifies dependencies and crontab setup.
