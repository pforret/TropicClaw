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

### USER.md — Who the human is

Builds a profile of the user over time:

- **Core fields** — name, preferred address, pronouns, timezone
- **Context** — priorities, active projects, pet peeves, humor preferences
- **Philosophy** — relationship-building, not surveillance; grows organically across sessions

### TOOLS.md — Environment-specific config

Stores locally-relevant details that complement skill definitions:

- **Device identifiers** — camera names, SSH hosts, speaker/room assignments
- **Config preferences** — TTS voice selections, default output devices
- **Location mappings** — device nicknames tied to physical spaces
- **Infrastructure** — host addresses, credentials, device aliases
- **Design principle** — separates "how tools work" (skills) from "your specifics" (this file)

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
| No separation of soul vs. identity vs. tools | MEDIUM | Everything lives in `CLAUDE.md` — behavioral rules, identity, and environment config are mixed together |
| No device/infrastructure registry | MEDIUM | No structured way to map device names, SSH hosts, camera IDs, etc. |
| No per-agent persona scoping | HIGH | Claude Code has one identity per project; cannot run multiple personas with different SOUL/IDENTITY |
| No template evolution tracking | LOW | `CLAUDE.md` changes aren't versioned or transparent to the agent |
| Auto-memory is append-heavy | LOW | Memory files grow but lack structured schema for user context |

## Build Recommendations

1. **Adopt the template convention directly** — Create `IDENTITY.md`, `SOUL.md`, `USER.md`, and `TOOLS.md` files in the project root and reference them from `CLAUDE.md` via includes or explicit instructions ("Read SOUL.md for behavioral guidelines"). Claude Code will read them when referenced.

2. **Structured auto-memory** — Define a schema for `memory/user.md` that mirrors USER.md's fields (name, timezone, preferences, projects). Instruct the agent in `CLAUDE.md` to maintain this structure.

3. **TOOLS.md as MCP config companion** — Store device/infrastructure mappings in a `TOOLS.md` that the agent reads alongside MCP server configs. This separates "how to call the tool" (MCP) from "which device to target" (TOOLS.md).

4. **Multi-persona via project directories** — For multiple agent personas, use separate project directories each with their own `CLAUDE.md` + template files. The gateway can route to the correct project based on channel or user.

5. **Template versioning** — Keep template files in git to track identity evolution. The agent can read git history to understand how its own personality has changed.

## Verdict

**YELLOW** — Claude Code's `CLAUDE.md` and auto-memory cover much of the functionality, but in an unstructured, monolithic way. The key gaps are: no structured schemas (identity, user, tools are all mixed), no per-agent persona scoping, and no device/infrastructure registry. Adopting OpenClaw's template convention on top of Claude Code is straightforward and requires no custom tooling — just file conventions and `CLAUDE.md` instructions.
