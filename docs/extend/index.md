# Extending Claude Code

Claude Code's extension layer lets you customize what the agent knows, connect it to external services, and automate workflows — all without modifying Claude Code itself. Extensions plug into different parts of the agentic loop.

> Sources: [Features overview](https://code.claude.com/docs/en/features-overview), [Skills](https://code.claude.com/docs/en/skills), [Hooks](https://code.claude.com/docs/en/hooks), [Plugins](https://code.claude.com/docs/en/plugins), [Bash tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/bash-tool)

## Extension mechanisms at a glance

| Mechanism       | What it does                              | Runs when         | Context cost      | Bash scripts?                                    |
|-----------------|-------------------------------------------|-------------------|-------------------|--------------------------------------------------|
| **CLAUDE.md**   | Persistent context loaded every session   | Session start     | Every request     | No (static text)                                 |
| **Skills**      | Reusable knowledge + invocable workflows  | On demand or auto | Low until invoked | Yes, via `!`backtick`` preprocessing + Bash tool |
| **Hooks**       | Deterministic scripts on lifecycle events | Event-triggered   | Zero (external)   | Yes, primary mechanism                           |
| **MCP servers** | Connect to external services/tools        | Session start     | Every request     | Yes, can wrap CLI tools                          |
| **Plugins**     | Bundle skills + hooks + MCP + agents      | When installed    | Varies            | Yes, in all components                           |
| **Subagents**   | Isolated workers with own context         | On demand         | Isolated          | Yes, via Bash tool                               |
| **Agent teams** | Multiple independent sessions             | On demand         | Separate sessions | Yes, via Bash tool                               |

## 1. CLAUDE.md — Always-on context

The simplest extension. Markdown files that Claude reads every session.

- **Global**: `~/.claude/CLAUDE.md` — applies to all projects
- **Project**: `CLAUDE.md` or `.claude/CLAUDE.md` — committed to repo
- **Local**: `.claude/settings.local.json` references — gitignored
- **Nested**: subdirectory `CLAUDE.md` files discovered as Claude works in those dirs

Best for "always do X" rules, project conventions, build commands. Keep under ~500 lines; move reference material to skills.

## 2. Skills — Knowledge + workflows via slash commands

Skills are markdown files (`SKILL.md`) that extend what Claude knows and can do. They replace and extend the older `.claude/commands/` system.

### Where skills live

| Scope      | Path                               |
|------------|------------------------------------|
| Personal   | `~/.claude/skills/<name>/SKILL.md` |
| Project    | `.claude/skills/<name>/SKILL.md`   |
| Plugin     | `<plugin>/skills/<name>/SKILL.md`  |
| Enterprise | Managed settings                   |

### Anatomy of a skill

```yaml
---
name: deploy
description: Deploy the application to production
disable-model-invocation: true   # only user can trigger
allowed-tools: Bash(npm *), Bash(git *)
context: fork                     # run in isolated subagent
agent: general-purpose
---

Deploy $ARGUMENTS to production:

1. Run `!`npm test`` to verify tests pass
2. Run `!`git log --oneline -5`` to show recent commits
3. Build and push the release
```

### How skills use bash

**Preprocessing with `!`command``:**
Shell commands inside backticks prefixed with `!` run *before* the skill content reaches Claude. The output replaces the placeholder.

```yaml
---
name: pr-summary
description: Summarize a pull request
context: fork
---

## PR context
- Diff: !`gh pr diff`
- Comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

Summarize this PR.
```

**Bash tool during execution:**
When `allowed-tools` includes `Bash(...)`, Claude can run shell commands as part of executing the skill. This is how skills perform real actions (deploy, test, lint, commit).

**Supporting scripts:**
Skills can include scripts in their directory that Claude executes:

```
my-skill/
├── SKILL.md
├── scripts/
│   └── validate.sh
│   └── visualize.py
```

### Key frontmatter options

| Field                            | Effect                                                       |
|----------------------------------|--------------------------------------------------------------|
| `name`                           | Slash command name (`/name`)                                 |
| `description`                    | Helps Claude decide when to auto-load                        |
| `disable-model-invocation: true` | Only user can trigger (prevents auto-invocation)             |
| `user-invocable: false`          | Only Claude can trigger (background knowledge)               |
| `allowed-tools`                  | Tools Claude can use without permission when skill is active |
| `context: fork`                  | Run in isolated subagent context                             |
| `agent`                          | Which subagent type to use (`Explore`, `Plan`, custom)       |
| `model`                          | Override model for this skill                                |
| `argument-hint`                  | Autocomplete hint (e.g., `[issue-number]`)                   |

### Argument substitution

| Variable                | Description                     |
|-------------------------|---------------------------------|
| `$ARGUMENTS`            | All arguments after `/name`     |
| `$ARGUMENTS[N]` or `$N` | Positional argument (0-indexed) |
| `${CLAUDE_SESSION_ID}`  | Current session ID              |

### CLI shortcut

```bash
# Run skill non-interactively
claude -p '/deploy staging'

# Shell alias for one-keystroke workflows
alias cdeploy="claude -p '/deploy'"
```

## 3. Hooks — Deterministic automation via bash scripts

Hooks are the primary mechanism for running bash scripts in response to Claude Code lifecycle events. They run **outside** the agentic loop — no LLM involved, just your script.

### Hook events

| Event                | When                                   | Can control?               |
|----------------------|----------------------------------------|----------------------------|
| `SessionStart`       | Session begins/resumes                 | No                         |
| `UserPromptSubmit`   | User submits prompt, before processing | Can modify prompt          |
| `PreToolUse`         | Before a tool call                     | Can **block** or **allow** |
| `PostToolUse`        | After a tool call succeeds             | Can inject messages        |
| `PostToolUseFailure` | After a tool call fails                | Can inject messages        |
| `PermissionRequest`  | Permission dialog appears              | Can auto-allow/deny        |
| `Notification`       | Notification sent                      | No                         |
| `SubagentStart/Stop` | Subagent spawns/finishes               | No                         |
| `Stop`               | Claude finishes responding             | No                         |
| `TaskCompleted`      | Task marked complete                   | No                         |
| `ConfigChange`       | Config file changes                    | No                         |
| `PreCompact`         | Before context compaction              | Can inject summary         |
| `SessionEnd`         | Session terminates                     | No                         |

### Configuration

Hooks are defined in settings JSON files:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | xargs eslint --fix"
          }
        ]
      }
    ]
  }
}
```

### Where hooks live

| Location                      | Scope                  |
|-------------------------------|------------------------|
| `~/.claude/settings.json`     | All projects           |
| `.claude/settings.json`       | Project (committable)  |
| `.claude/settings.local.json` | Project (local only)   |
| Plugin `hooks/hooks.json`     | When plugin enabled    |
| Skill/agent frontmatter       | While component active |

### Hook I/O pattern

1. Claude Code sends JSON context on **stdin** (tool name, inputs, outputs, etc.)
2. Your script reads stdin, processes, takes action
3. Script optionally returns JSON on **stdout** (decisions like allow/deny/modify)
4. Exit code 0 = success, non-zero = error (shown to Claude)

### Example: Block destructive commands

```bash
#!/bin/bash
# .claude/hooks/block-rm.sh
COMMAND=$(jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q 'rm -rf'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive command blocked"
    }
  }'
else
  exit 0
fi
```

### Example: Auto-lint after every file edit

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{
          "type": "command",
          "command": "jq -r '.tool_input.file_path' | xargs prettier --write"
        }]
      }
    ]
  }
}
```

### Example: Notify on task completion

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "echo 'Claude finished' | terminal-notifier -title 'Claude Code'"
        }]
      }
    ]
  }
}
```

## 4. MCP Servers — External tool integration

MCP (Model Context Protocol) connects Claude to external services. Each MCP server exposes tools Claude can call.

```json
// .claude/settings.json
{
  "mcpServers": {
    "my-db": {
      "command": "node",
      "args": ["./mcp-servers/db-server.js"],
      "env": { "DB_URL": "postgres://..." }
    }
  }
}
```

MCP servers can wrap any CLI tool or API. Claude calls them like native tools. Combine with skills to teach Claude *how* to use the tools effectively.

## 5. Plugins — Packaging and distribution

Plugins bundle skills + hooks + MCP servers + agents into installable units.

### Structure

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json         # manifest (name, version, description)
├── skills/                  # skills with SKILL.md files
│   └── review/
│       └── SKILL.md
├── agents/                  # custom subagent definitions
├── hooks/
│   └── hooks.json           # hook configurations
├── .mcp.json                # MCP server configs
├── .lsp.json                # LSP server configs
└── settings.json            # default settings
```

### Plugin manifest

```json
{
  "name": "my-plugin",
  "description": "Code quality tools",
  "version": "1.0.0",
  "author": { "name": "Your Name" }
}
```

Plugin skills are namespaced: `/my-plugin:review` prevents conflicts between plugins.

### Testing locally

```bash
claude --plugin-dir ./my-plugin
```

### Distribution

Plugins are shared via **marketplaces** — JSON registries that list available plugins. Install with `/plugin install`.

## 6. Subagents and agent teams

**Subagents** run in isolated context, returning only summaries. Useful for research, parallel work, and keeping the main context clean.

**Agent teams** (experimental) are multiple independent Claude Code sessions that coordinate via shared task lists and peer-to-peer messaging.

Both can use the Bash tool and load skills.

## Combining extensions

| Pattern                       | Example                                                           |
|-------------------------------|-------------------------------------------------------------------|
| **Skill + MCP**               | MCP connects to your DB; skill teaches Claude your schema         |
| **Skill + Subagent**          | `/review` spawns security + performance + style subagents         |
| **Hook + MCP**                | Post-edit hook sends Slack notification via MCP                   |
| **CLAUDE.md + Skills**        | CLAUDE.md says "follow API conventions"; skill has the full guide |
| **Plugin = all of the above** | Bundled, versioned, distributable                                 |

## Relevance to OpenClaw

Claude Code's extension layer maps to several OpenClaw subsystems:

| OpenClaw Subsystem    | Claude Code Extension                                         |
|-----------------------|---------------------------------------------------------------|
| **Tools & Skills**    | Skills + MCP servers (closest match)                          |
| **Agent Runtime**     | Subagents + agent teams + `context: fork` skills              |
| **Memory**            | CLAUDE.md + auto-memory (partial; no vector search)           |
| **Gateway**           | Hooks (lifecycle events), but no persistent daemon            |
| **Channels**          | MCP servers (per-platform adapters), but must be custom-built |
| **Scheduling**        | Hooks + external cron + `claude -p` (no self-scheduling)      |
| **Persona templates** | CLAUDE.md + skill files (unstructured equivalent)             |

The extension layer covers **tools, skills, and agent runtime** well. It provides building blocks for **gateway and channels** (hooks, MCP) but requires custom orchestration. **Memory** and **scheduling** remain the biggest gaps requiring standalone services.
