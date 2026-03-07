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

## Gaps

| Gap | Severity | Notes |
|---|---|---|
| No graduated permission tiers | HIGH | Binary: approve-each-call or skip-all |
| No per-context trust profiles | HIGH | Can't say "trust for file ops, ask for network" in a single session |
| No enforceable guardrails for scheduled jobs | HIGH | CLAUDE.md guardrails are advisory; agent can ignore them |
| No environment isolation | MEDIUM | No container/VM sandboxing for risky operations |
| No trust audit trail | MEDIUM | No log of which permissions were granted/used |
| No dynamic trust adjustment | LOW | Cannot increase/decrease trust based on track record |

## Areas It Influences

This is a **cross-cutting concern** that affects every other subsystem:

| Subsystem | How autonomy/trust applies |
|---|---|
| **Gateway** | Gateway must enforce trust boundaries before dispatching to agents |
| **Channels** | Inbound messages from authorized users carry implicit trust; unknown senders don't |
| **Agent Runtime** | Each agent/persona needs its own trust profile (a coding agent gets file access; a comms agent gets messaging access) |
| **Tools & Skills** | Tool allow/deny lists are the mechanism, but they need per-context granularity |
| **Memory** | Memory writes should be trusted; memory *reads* that influence actions need provenance |
| **Self-Scheduling** | Scheduled jobs run unattended — trust model is critical; each job needs bounded authority |
| **Persona Templates** | Trust profile should be part of the persona definition (TOOLS.md in OpenClaw) |

## Build Recommendations

### Tiered Permission Model

Define trust tiers that can be assigned per-agent, per-job, or per-channel:

| Tier | Allowed | Example |
|---|---|---|
| **0 — Read-only** | Read files, search, web fetch | Monitoring/reporting jobs |
| **1 — Local write** | + Write/edit files, git commit | Development tasks |
| **2 — Network** | + API calls, web requests, send messages | Channel interactions |
| **3 — System** | + Install packages, run services, destructive ops | Infrastructure tasks |

### Enforceable Guardrails

Move from advisory (CLAUDE.md text) to enforced (hook-based validation):

- **PreToolUse hooks** that check proposed actions against the job's trust tier
- **Deny-list patterns** (e.g., block `rm -rf /`, `DROP TABLE`, force-push) regardless of tier
- **Rate limiting** — cap the number of tool calls per session/job to prevent runaway loops

### Per-Job Trust Profiles

Extend the tropicron job format with explicit trust declarations:

```yaml
trust_tier: 1
allowed_tools: [Read, Write, Edit, Glob, Grep, Bash]
denied_patterns: ["rm -rf", "git push --force", "DROP"]
max_tool_calls: 50
```

## Verdict

**YELLOW** — Claude Code has the *mechanism* (`allowed-tools`, approval prompts) but not the *model* (graduated tiers, per-context profiles, enforceable guardrails). The binary skip-permissions flag is insufficient for a 24/7 multi-agent system. A trust framework must be designed as a cross-cutting layer before building scheduled jobs or channel adapters.
