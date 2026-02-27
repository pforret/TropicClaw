# Gap Analysis: Agent Runtime

## OpenClaw Feature

The Agent Runtime manages conversation state and agent execution:

- **Multi-turn conversations** with context preservation
- **Append-only session logs** for auditability
- **Dynamic system prompts** that adapt based on context, channel, user
- **Multi-agent orchestration** — separate personas with distinct tools, running simultaneously
- **Agent-per-channel routing** — different agents handle different channels
- **Tool execution sandboxing** — agents can only use their allowed tools

## Claude Code Coverage

| Feature                  | Status  | Claude Code Primitive                                           |
|--------------------------|---------|-----------------------------------------------------------------|
| Multi-turn conversations | Yes     | Native — context window with auto-compression                   |
| System prompts           | Yes     | `CLAUDE.md` files (global, project, local)                      |
| Dynamic system prompts   | Partial | Can swap `CLAUDE.md` content, but not mid-session               |
| Sub-agent spawning       | Yes     | Skills with `context: fork`, Task tool                          |
| Tool execution           | Yes     | Built-in tools (Bash, Read, Edit, Write, Glob, Grep, etc.)      |
| Tool permissions         | Yes     | `allowed-tools` in settings, per-project                        |
| Session resume           | Yes     | `--resume` flag, `--continue` for last session                  |
| Session logs             | Partial | Internal transcript stored, but not in append-only audit format |

**What works:**
- Claude Code's core is a capable multi-turn agent runtime
- `CLAUDE.md` provides layered system prompts (global → project → local)
- Skills with `context: fork` create sub-agents with isolated context
- `allowed-tools` restricts which tools an agent can use
- `--resume` enables session continuity across CLI invocations

## Gaps

| Gap                                | Severity | Notes                                                             |
|------------------------------------|----------|-------------------------------------------------------------------|
| No append-only session logs        | ~~MEDIUM~~ → **ADDRESSED** | Addressed by `auditlog.sh` — hook-based JSON-lines logging |
| No multi-agent orchestration       | HIGH     | Cannot run multiple agents simultaneously with different personas |
| No agent-per-channel routing       | HIGH     | No mechanism to route messages from channel X to agent Y          |
| No dynamic system prompt switching | MEDIUM   | `CLAUDE.md` is static within a session                            |
| No agent registry                  | MEDIUM   | No way to define, list, and manage multiple agent configurations  |
| No conversation indexing           | ~~LOW~~ → **PARTIAL** | Keyword search via `auditlog search`; semantic search still requires Memory MCP |

## Build Recommendations

1. **Agent registry config** — Define agents in a YAML/JSON config with persona, allowed tools, assigned channels:
   ```yaml
   agents:
     assistant:
       system_prompt: prompts/assistant.md
       channels: [slack, telegram]
       allowed_tools: [Read, Write, WebSearch]
     coder:
       system_prompt: prompts/coder.md
       channels: [discord]
       allowed_tools: [Bash, Read, Edit, Write]
   ```
2. **Gateway-level routing** — The gateway process (see 01-gateway.md) routes incoming messages to the correct agent based on channel/user
3. **Append-only logs via hooks** — ✅ Implemented as `auditlog.sh` (see [PRP](../../PRPs/2026-02-27-auditlog.md)). Uses `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SessionStart`, `SessionEnd` hooks to append JSON-lines per session. CLI provides search, list, stats, export.
4. **Multi-agent via parallel `claude` processes** — Each agent runs as a separate `claude -p` invocation with its own `CLAUDE.md` and `allowed-tools`
5. **Dynamic prompts via file switching** — Gateway writes the appropriate `CLAUDE.md` before invoking the agent

## Verdict

**YELLOW** — Claude Code is already a strong single-agent runtime with multi-turn support, system prompts, and tool permissions. The main gaps are multi-agent orchestration and structured audit logging, which can be built in the gateway layer.
