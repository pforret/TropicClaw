# Gap Analysis: Tools & Skills

## OpenClaw Feature

OpenClaw provides a rich set of tools and an installable skill package system:

- **Built-in tools**: Shell execution, browser automation, canvas rendering, messaging, camera, location
- **Skill packages**: Installable, versioned skill bundles
- **Per-agent allow/deny lists**: Fine-grained control over which agent can use which tools
- **Tool discovery**: Agents can discover available tools at runtime
- **Sandboxed execution**: Tools run in isolated environments

## Claude Code Coverage

| Feature                    | Status  | Claude Code Primitive                                        |
|----------------------------|---------|--------------------------------------------------------------|
| Shell execution            | Yes     | `Bash` tool                                                  |
| File operations            | Yes     | `Read`, `Write`, `Edit`, `Glob`, `Grep` tools                |
| Web search                 | Yes     | `WebSearch` tool                                             |
| Web fetch                  | Yes     | `WebFetch` tool                                              |
| Browser automation         | Yes     | Computer use / Playwright via skills                         |
| Skill packages             | Yes     | Skills system (project skills, document-skills, user skills) |
| Per-agent tool permissions | Yes     | `allowed-tools` in settings                                  |
| MCP tool integration       | Yes     | MCP servers expose custom tools                              |
| Tool discovery             | Partial | Tools listed in system prompt, MCP tools via `mcp__` prefix  |
| Notebook editing           | Yes     | `NotebookEdit` tool                                          |

**What works:**
- Comprehensive built-in tool set covering shell, file ops, search, and web
- Skills system closely matches OpenClaw's installable packages concept
- `allowed-tools` provides per-project (effectively per-agent) tool restrictions
- MCP protocol allows adding arbitrary external tools
- Document-skills provide specialized capabilities (PDF, XLSX, PPTX, etc.)

## Gaps

| Gap                          | Severity | Notes                                                                         |
|------------------------------|----------|-------------------------------------------------------------------------------|
| No camera/photo tools        | LOW      | Not typical for CLI agents; could add via MCP                                 |
| No GPS/location tools        | LOW      | Could integrate via MCP with device APIs                                      |
| No canvas/image rendering    | MEDIUM   | No native drawing; document-skills have `canvas-design` and `algorithmic-art` |
| No sandboxed shell isolation | MEDIUM   | Bash runs in user's environment; no container isolation                       |
| No tool versioning           | LOW      | Skills don't have version management                                          |
| No tool marketplace/registry | LOW      | No centralized discovery beyond MCP registry                                  |

## Build Recommendations

1. **Camera/location via MCP** — If needed, build lightweight MCP servers that interface with device APIs (e.g., `imagesnap` on macOS for camera, CoreLocation for GPS)
2. **Canvas rendering** — Leverage existing `canvas-design` and `algorithmic-art` skills, or build an MCP server wrapping a headless browser for rendering
3. **Sandboxed execution** — Use Docker containers or macOS sandbox profiles for tool isolation:
   - MCP servers can run inside containers
   - Bash commands can be routed through a sandboxed executor
4. **Skill packaging** — Use the existing skills system as-is; it already supports project-level and user-level skill installation
5. **Tool registry** — The MCP registry already serves as a tool discovery mechanism; extend with a local catalog if needed

## Verdict

**GREEN/YELLOW** — Claude Code's tool and skill ecosystem is the closest match to OpenClaw's design. Built-in tools cover most needs, skills provide extensibility, and MCP enables custom integrations. Minor gaps (camera, location, sandboxing) are addressable with targeted MCP servers.
