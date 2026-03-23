# Installing TropicClaw

## Prerequisites

| Requirement | Version | Check |
|-------------|---------|-------|
| **Claude Code** (CLI) | latest | `claude --version` |
| **Bun** | 1.0+ | `bun --version` |
| **Bash** | 4+ | `bash --version` |
| **Git** | any | `git --version` |
| **Node.js** | 18+ | `node --version` (needed by some MCP servers) |

### Optional

- **mkdocs-material** — to build/serve the docs site locally (`pip install mkdocs-material mkdocs-awesome-pages-plugin`)
- **lynx** or **pandoc** — for tropicron's `url-changed.sh` HTML conversion
- **jq** — for tropicron's `url-changed.sh` JSON formatting

## 1. Clone the repository

```bash
git clone https://github.com/pforret/TropicClaw.git
cd TropicClaw
```

## 2. Install gateway dependencies

```bash
cd gateway
bun install
cd ..
```

This installs Fastify, grammY (Telegram), twitter-api-v2, and other runtime dependencies.

## 3. Configure environment variables

```bash
cp gateway/.env.example gateway/.env
```

Edit `gateway/.env` and fill in the values you need:

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | For Telegram | Bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_OWNER_ID` | For Telegram | Your Telegram user ID (allowlist) |
| `TELEGRAM_CHANNEL_ID` | No | Channel for bookmark publishing (e.g. `@mybookmarks`) |
| `TWITTER_API_KEY` | No | Twitter/X API key for bookmark publishing |
| `TWITTER_API_SECRET` | No | Twitter/X API secret |
| `TWITTER_ACCESS_TOKEN` | No | Twitter/X access token |
| `TWITTER_ACCESS_SECRET` | No | Twitter/X access secret |

## 4. Configure the gateway

Edit `gateway/config/gateway.yaml` to set your owner IDs and preferences:

```yaml
owner:
  telegram_id: "123456789"    # your Telegram user ID
  slack_id: ""                # future use
  discord_id: ""              # future use

port: 18789
host: "127.0.0.1"
max_concurrent_agents: 3

bookmarks:
  enabled: true
  auto_detect_urls: true
  summary_model: haiku
```

## 5. Start the gateway

```bash
# Production mode (quiet output)
./gateway.sh start

# Development mode (verbose, auto-reload on file changes)
./gateway.sh dev
```

The gateway starts at `http://127.0.0.1:18789/` by default. It will open your browser automatically.

### Verify it's running

```bash
curl http://127.0.0.1:18789/health
```

## 6. Set up tropicron (scheduled jobs)

tropicron is an optional cron-based scheduler that runs Claude Code sessions on a schedule.

```bash
# Install the crontab entry (runs every minute)
apps/tropicron/bin/tropicron.sh install

# Add an example job
apps/tropicron/bin/tropicron.sh add apps/tropicron/examples/health-check.md

# Verify
apps/tropicron/bin/tropicron.sh list

# Test a job without executing it
apps/tropicron/bin/tropicron.sh test health-check
```

To use the `/tropicron` slash command inside Claude Code, copy the skills into your project:

```bash
cp -r apps/tropicron/skills/tropicron .claude/skills/
cp -r apps/tropicron/skills/tropicron-memory .claude/skills/
```

## 7. Set up agents

Agent configurations live in `gateway/agents/`. Each agent has its own directory with:

- `agent.yaml` — model, trust tier, timeout, max turns
- `CLAUDE.md` — system prompt and behavior instructions
- `SOUL.md` — personality/persona definition (optional)

The default `main` agent is pre-configured. To add a new agent, create a subdirectory:

```bash
mkdir gateway/agents/my-agent
```

Then add `agent.yaml` and `CLAUDE.md` files following the `main` agent as a template.

## 8. Serve the docs (optional)

```bash
pip install mkdocs-material mkdocs-awesome-pages-plugin
mkdocs serve
```

Opens at `http://127.0.0.1:8000/`.

## Project structure

```
TropicClaw/
├── gateway.sh              # Gateway launcher script
├── gateway/
│   ├── .env.example        # Environment template
│   ├── package.json        # Bun dependencies
│   ├── config/
│   │   └── gateway.yaml    # Gateway configuration
│   ├── agents/
│   │   └── main/           # Default agent (CLAUDE.md, SOUL.md, agent.yaml)
│   ├── hooks/
│   │   └── trust-enforcer.sh  # PreToolUse trust tier enforcement
│   └── src/                # Gateway source (TypeScript/Bun)
│       ├── index.ts        # Entry point
│       ├── router.ts       # HTTP routing
│       ├── agent-pool.ts   # Agent lifecycle management
│       ├── session-store.ts # SQLite session persistence
│       ├── web.ts          # Web dashboard
│       └── adapters/       # Channel adapters (Telegram, etc.)
├── apps/
│   ├── tropicron/          # Scheduled job runner
│   └── bookmarks/          # Bookmark management service
├── docs/                   # MkDocs documentation source
│   ├── gap/                # Gap analysis (OpenClaw vs Claude Code)
│   └── extend/             # Claude Code extension reference
├── CLAUDE.md               # Project instructions for Claude Code
└── mkdocs.yml              # MkDocs configuration
```

## Troubleshooting

**Gateway won't start** — Check that port 18789 isn't already in use: `lsof -i :18789`

**Bun not found** — Install Bun: `curl -fsSL https://bun.sh/install | bash`

**Claude CLI not found** — Install Claude Code following [the official docs](https://docs.anthropic.com/en/docs/claude-code)

**Telegram bot not responding** — Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OWNER_ID` in `gateway/.env`. The owner ID must match your Telegram account exactly.

**tropicron jobs not running** — Run `apps/tropicron/bin/tropicron.sh check` to verify dependencies and crontab setup.
