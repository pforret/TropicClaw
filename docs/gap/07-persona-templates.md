# Gap Analysis: Persona & Configuration Templates

## OpenClaw Feature

OpenClaw uses a set of structured Markdown templates at the workspace root to define agent identity, behavior, user context, and environment-specific config. These files are living documents that evolve across sessions.

### IDENTITY.md — Who the agent is

Defines the agent's core identity:

- **Name** — chosen identifier
- **Creature** — ontological category (AI, robot, familiar, etc.)
- **Vibe** — personality descriptors (sharp, warm, chaotic, calm)
- **Emoji** — symbolic signature
- **Avatar** — visual representation (file path, URL, or data URI)

### SOUL.md — How the agent behaves

Defines behavioral principles and boundaries:

- **Core truths** — authenticity over performance, hold opinions, self-reliance, earn trust through competence
- **Boundaries** — privacy is absolute, confirm before external actions, substantive responses only, don't impersonate user in groups
- **Vibe** — cultural directive for natural communication (not corporate, not obsequious)
- **Continuity** — this file is the agent's memory layer; updates signal identity evolution

### AGENTS.md — Operating manual

The primary instruction file for how the agent should think and act:

- **When to use which tool** and in what order
- **Safety rules** — what the agent must never do
- **Workflow patterns** — how to handle common scenarios
- **Integration instructions** — e.g., "use browser tool with saved session to check Gmail"

### USER.md — Who the human is

Builds a profile of the user over time:

- **Core fields** — name, preferred address, pronouns, timezone
- **Context** — priorities, active projects, pet peeves, humor preferences
- **Philosophy** — relationship-building, not surveillance; grows organically across sessions

### MEMORY.md — Long-term facts

Facts that must not get lost between sessions:

- "We only trade on DEX, no CEX"
- "Primary RPC is Alchemy, Infura as backup"
- The agent writes here on its own or when you tell it to
- Indexed by semantic search for on-demand retrieval

### YYYY-MM-DD.md — Daily logs

What happened today, tasks in progress, what was discussed. Tomorrow the agent opens yesterday's log and picks up the context. Part of the bootstrap injection (today's log is always included).

### HEARTBEAT.md — Periodic checks

A checklist for the agent to verify on a schedule:

- "Check email"
- "See if monitoring is running"
- "Disk space okay?"

Used by the heartbeat cron feature (see [Self-Scheduling](06-self-scheduling.md)).

### TOOLS.md — Environment-specific config

Stores locally-relevant details that complement skill definitions:

- **Device identifiers** — camera names, SSH hosts, speaker/room assignments
- **Config preferences** — TTS voice selections, default output devices
- **Location mappings** — device nicknames tied to physical spaces
- **Infrastructure** — host addresses, credentials, device aliases
- **Design principle** — separates "how tools work" (skills) from "your specifics" (this file)

### Bootstrap Injection

Every time the agent runs, Gateway reads AGENTS.md, SOUL.md, USER.md, IDENTITY.md, and today's daily log and injects them into context **before** the LLM sees the user's message. This is the first level of memory. The agent sees these files every single time — but they eat tokens. More content = more expensive per request. See [Memory](05-memory.md) for the full two-level architecture.

## Claude Code Coverage

| Feature | Status | Claude Code Primitive |
|---------|--------|-----------------------|
| Agent name/identity | Partial | Can be described in `CLAUDE.md` but no structured format |
| Agent personality/vibe | Partial | `CLAUDE.md` instructions shape tone and behavior |
| Behavioral boundaries | Partial | `CLAUDE.md` + `settings.json` (`allowed-tools`, permission modes) |
| Agent avatar/emoji | No | — |
| User profile | Partial | Auto-memory files can accumulate user info, but unstructured |
| User timezone/preferences | No | — (no structured user model) |
| Environment-specific config | Partial | `.claude/settings.local.json` for local overrides; MCP server configs |
| Device/infrastructure registry | No | — |
| Template evolution across sessions | Partial | Auto-memory persists; `CLAUDE.md` is manually maintained |
| Per-agent scoping | No | Single agent identity per project |
| Multi-agent personas | No | — |

**What works:**

- `CLAUDE.md` (global + project + local) is the closest equivalent to SOUL.md + IDENTITY.md combined — it shapes agent behavior, tone, and project-specific instructions
- Auto-memory (`~/.claude/projects/<project>/memory/`) persists knowledge across sessions, partially covering USER.md's evolving profile
- `.claude/settings.local.json` provides environment-specific overrides, partially covering TOOLS.md
- MCP server configs in settings can reference local infrastructure (hosts, APIs)

## Gaps

| Gap | Severity | Notes |
|-----|----------|-------|
| No structured identity schema | MEDIUM | `CLAUDE.md` is freeform; no name/creature/avatar/emoji fields |
| No agent avatar or visual identity | LOW | Purely CLI-based; no visual representation |
| No explicit user model | MEDIUM | Auto-memory captures info ad-hoc but has no structured user profile (name, timezone, pronouns, preferences) |
| No separation of soul vs. identity vs. tools vs. agents | MEDIUM | Everything lives in `CLAUDE.md` — behavioral rules, identity, environment config, and operating instructions are mixed. OpenClaw separates: SOUL.md (behavior), IDENTITY.md (who), USER.md (human), AGENTS.md (how to work), TOOLS.md (environment), MEMORY.md (facts), HEARTBEAT.md (checks) |
| No device/infrastructure registry | MEDIUM | No structured way to map device names, SSH hosts, camera IDs, etc. |
| No per-agent persona scoping | HIGH | Claude Code has one identity per project; cannot run multiple personas with different SOUL/IDENTITY |
| No template evolution tracking | LOW | `CLAUDE.md` changes aren't versioned or transparent to the agent |
| Auto-memory is append-heavy | LOW | Memory files grow but lack structured schema for user context |
| No daily log convention | LOW | No `YYYY-MM-DD.md` for daily context injection. Could be adopted as a file convention |
| No heartbeat checklist | LOW | No `HEARTBEAT.md` for periodic verification tasks. Could be adopted with cronbot |
| No bootstrap injection mechanism | MEDIUM | `CLAUDE.md` is always loaded, but no control over which files are "bootstrap" (always injected) vs "on-demand" (semantic search). OpenClaw distinguishes these explicitly |

## Existing MCP Plugin

### Installed: claude-memory-mcp (identity persistence)

- **Package**: `npx -y @whenmoon-afk/memory-mcp`
- **Stars**: ~59 on GitHub
- **Approach**: File-based identity persistence with promotion scoring
- **Install**: `claude mcp add identity -- npx -y @whenmoon-afk/memory-mcp`

**Identity structure** (maps closely to OpenClaw templates):

| claude-memory-mcp file | OpenClaw equivalent |
|------------------------|---------------------|
| `soul.md` | `SOUL.md` — core values and behavioral truths |
| `self-state.md` | `YYYY-MM-DD.md` — last 5 sessions of recent history |
| `identity-anchors.md` | `IDENTITY.md` — promoted patterns that define the agent |
| `observations.json` | `MEMORY.md` — frequency-tracked concepts |

**Three tools**:
- `reflect` — End-of-session analysis; auto-promotes frequently observed concepts
- `anchor` — Explicit identity writing to soul, self-state, or anchors
- `self` — Queries current identity state and observation scores

**Promotion algorithm**: `score = sqrt(recalls) * log2(days + 1) * diversity_bonus * recency`
Concepts automatically graduate to anchors when scoring crosses threshold; stale observations auto-prune after 30 days.

**Key properties**: Zero network calls, zero external dependencies, MIT license, optional zero-context-token mode via hooks-only.

**OpenClaw gap coverage**:

| Gap | Covered? |
|-----|----------|
| No structured identity schema | Yes — soul.md + identity-anchors.md |
| No explicit user model | No — focuses on agent identity, not user |
| No separation of soul/identity/tools | Yes — separate files per concern |
| No per-agent persona scoping | Partial — one identity set per install |
| No template evolution tracking | Yes — promotion scoring tracks concept evolution |

## Build Recommendations

With claude-memory-mcp installed, the remaining work is:

1. **Adopt the template convention** — Create `USER.md` and `TOOLS.md` alongside the identity plugin's files. Reference them from `CLAUDE.md`.

2. **Structured auto-memory** — Define a schema for `memory/user.md` that mirrors USER.md's fields (name, timezone, preferences, projects). Instruct the agent in `CLAUDE.md` to maintain this structure.

3. **TOOLS.md as MCP config companion** — Store device/infrastructure mappings in a `TOOLS.md` that the agent reads alongside MCP server configs.

4. **Multi-persona via project directories** — For multiple agent personas, use separate project directories each with their own `CLAUDE.md` + identity plugin instance. The Gateway PRP's agent auto-discovery (`agents/*/CLAUDE.md`) implements this directly.

5. **Template versioning** — Keep template files in git to track identity evolution.

6. **Dreaming as persona evolution engine** — The Gateway's nightly dreaming process (see [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md#dreaming-nightly-session-maintenance)) evolves persona files incrementally based on the day's conversations. SOUL.md gets refined communication patterns, USER.md accumulates preferences, TOOLS.md gets updated infra mappings. The `reflect` and `anchor` tools from claude-memory-mcp auto-promote recurring patterns into identity anchors. This closes the "template evolution tracking" gap without manual maintenance.

## Verdict

**GREEN/YELLOW** — With claude-memory-mcp installed, the core identity persistence gap is addressed. The plugin provides structured soul/identity/anchors separation that maps directly to OpenClaw's template convention. Remaining gaps are: no structured user model (USER.md), no device registry (TOOLS.md), and no multi-agent persona scoping. These can be addressed by file conventions without custom tooling.
