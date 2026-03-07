# Gap Analysis: Autonomy & Trust Model

## What It Is

The autonomy/trust model defines **how much independent authority the agent has** to act without per-action human approval. It's the governance layer that determines what the agent can do on its own vs. what requires explicit confirmation.

OpenClaw operates on a **senior-developer trust model**: the user reviews finished products (completed features, summarized reports, deployed changes) rather than approving each individual tool call. The agent is trusted to make tactical decisions within strategic boundaries.

Claude Code operates on an **approval-gated model**: each tool call outside a narrow safe-list requires explicit user confirmation. The escape hatch is `--dangerously-skip-permissions`, which removes *all* gates — an all-or-nothing binary.

## Why We Need It

Without a graduated trust model, you're stuck choosing between:

1. **Babysitting** — approving every shell command, file write, and API call (defeats the purpose of an autonomous agent)
2. **Blank check** — `--dangerously-skip-permissions` removes all safety checks (unacceptable for long-running or scheduled jobs)

Neither is appropriate for a personal AI assistant that runs 24/7, handles multiple channels, and performs scheduled tasks. The agent needs enough autonomy to be useful but bounded enough to be safe.

## OpenClaw's Approach

| Principle | Implementation |
|---|---|
| **Trust boundaries** | Agent operates freely within defined scope; escalates outside it |
| **Environment isolation** | Sandboxed execution limits blast radius of mistakes |
| **Review-at-output** | User reviews results, not process — "show me the PR" not "may I run git?" |
| **Graduated escalation** | Read → local-write → network → destructive, each with different thresholds |
| **Self-termination** | Agent aborts if it detects it's about to exceed its authority |

## Claude Code Coverage

| Feature | Status | Claude Code Primitive |
|---|---|---|
| Per-tool permission control | Yes | `allowed-tools` in settings |
| Approval prompting | Yes | Interactive permission modal |
| Skip all permissions | Yes | `--dangerously-skip-permissions` |
| Graduated trust tiers | No | — |
| Per-job safety scoping | Partial | `CLAUDE.md` guardrails (advisory, not enforced) |
| Environment sandboxing | Partial | macOS sandbox for some operations; no container isolation |
| Self-termination on boundary violation | No | — |

## Gateway PRP: Trust Design

The [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md) defines a concrete trust model that addresses the graduated-tier gap. Key simplifications from the single-user model:

### Single-User Model

This is a **single-user system**. All channels are used by the same owner. There are no multi-user allowlists or per-user trust profiles. The only isolation axis is **per-agent** — different agents have different trust tiers.

### Owner Verification (Layer 1)

Before any processing, the router checks that the message comes from the owner (one platform ID per channel in `gateway.yaml`). Non-owner messages are silently dropped. Simple, fail-closed.

### Trust Tiers (Layer 2)

Each agent has a `trust_tier` in its `agent.yaml`. A `PreToolUse` hook (`trust-enforcer.sh`) enforces the tier at the Claude Code level:

| Tier | Allowed | Typical Use |
|---|---|---|
| **0 — Read-only** | Read, Glob, Grep, WebSearch, WebFetch | Monitoring, reporting |
| **1 — Local write** | + Write, Edit, Bash (non-destructive), git commit | Development tasks |
| **2 — Network** | + MCP tools, API calls, send messages | Channel interactions |
| **3 — System** | + Destructive ops, package install, force-push | Infrastructure (rare) |

The tier is passed as `TRUST_TIER` env var when spawning `claude -p`. The hook inspects each tool call and denies operations above the agent's tier. Destructive patterns (`rm -rf`, `DROP TABLE`, `git push --force`) require tier 3 regardless.

### Per-Agent Trust Profiles

```yaml
# gateway/agents/monitor/agent.yaml
model: haiku
trust_tier: 0          # read-only — can observe but not modify
```

```yaml
# gateway/agents/coder/agent.yaml
model: opus
trust_tier: 1          # can write files and commit, not network
```

```yaml
# gateway/agents/main/agent.yaml
model: sonnet
trust_tier: 2          # full access including MCP/network tools
```

### Tropicron Trust Integration

Tropicron jobs already support trust-adjacent features:
- `sandbox: true` — runs with `--sandbox` (restricted permissions)
- `allowedTools:` — comma-separated tool allowlist per job
- Safety guardrails section in each job `.md` (advisory but respected by Claude)

The gateway's `trust-enforcer.sh` hook will also apply to tropicron jobs when they target a specific agent directory.

## Gaps

| Gap | Severity | Notes |
|---|---|---|
| No graduated permission tiers | ~~HIGH~~ → **DESIGNED** | Gateway PRP: trust tiers 0–3 with `PreToolUse` hook enforcement |
| No per-context trust profiles | ~~HIGH~~ → **DESIGNED** | Gateway PRP: per-agent `trust_tier` in `agent.yaml` |
| No enforceable guardrails for scheduled jobs | ~~HIGH~~ → **PARTIAL** | Tropicron: `sandbox`, `allowedTools`; gateway hook adds tier enforcement |
| No environment isolation | MEDIUM | No container/VM sandboxing; Claude Code `--sandbox` is partial |
| No trust audit trail | ~~MEDIUM~~ → **ADDRESSED** | Tropiclog records all tool calls with inputs/outputs as JSON-lines |
| No dynamic trust adjustment | LOW | No automatic tier changes based on track record |

## Areas It Influences

This is a **cross-cutting concern** that affects every other subsystem:

| Subsystem | How autonomy/trust applies |
|---|---|
| **Gateway** | Owner verification (layer 1) + trust tier enforcement (layer 2) before dispatching |
| **Channels** | Single-user: all inbound messages verified as owner; non-owner silently dropped |
| **Agent Runtime** | Each agent has its own `trust_tier` in `agent.yaml`; enforced by `PreToolUse` hook |
| **Tools & Skills** | `allowedTools` per agent (`.claude/settings.json`) + tier-based hook filtering |
| **Memory** | Memory writes at tier 1+; MCP-based memory tools at tier 2+ |
| **Self-Scheduling** | Tropicron: `sandbox`, `allowedTools` per job; gateway hook adds tier enforcement |
| **Persona Templates** | Trust tier is part of `agent.yaml` alongside model, description, timeout |

## Remaining Build Work

1. **Implement `trust-enforcer.sh`** — `PreToolUse` hook that reads `TRUST_TIER` env var and denies operations above the tier. Designed in Gateway PRP, needs implementation.
2. **Container isolation** (optional) — For tier-0 agents, consider running inside a container for true sandboxing. Low priority.
3. **Rate limiting** (optional) — Cap tool calls per session to prevent runaway loops. Not yet designed.

## Verdict

**YELLOW → GREEN (pending implementation)** — The trust model is now fully designed in the [Gateway PRP](../todo/PRPs/2026-03-07-gateway.md): single-user owner verification, 4-tier graduated permissions, per-agent trust profiles, `PreToolUse` hook enforcement, and tropiclog audit trail. The binary skip-permissions problem is solved by tiered enforcement. Upgrades to GREEN once `trust-enforcer.sh` is implemented.
