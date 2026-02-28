# Gap Analysis: Tools & Skills

## OpenClaw Feature

OpenClaw provides a rich set of tools and an installable skill package system:

- **Built-in tools**: Shell execution, browser automation, canvas rendering, messaging, camera, location
- **Skill packages**: Installable, versioned skill bundles
- **Per-agent allow/deny lists**: Fine-grained control over which agent can use which tools
- **Tool discovery**: Agents can discover available tools at runtime
- **Sandboxed execution**: Tools run in isolated environments

### Browser Automation in OpenClaw

OpenClaw includes a single built-in tool for browser control:

| Tool | Purpose |
|------|---------|
| `browser.action` | Automate a headless browser (navigate, click, screenshot, scrape) |

Key characteristics:
- **Four core verbs**: navigate, click, screenshot, scrape
- **Headless by default** — runs in an optional Docker container for isolation
- **Implementation-agnostic** — the architecture doesn't specify Puppeteer, Playwright, or other framework
- **First-class built-in** — always available, zero-config, subject to standard agent permissions
- **No explicit DOM selectors, form-fill API, JS injection, or multi-tab support** documented

OpenClaw also provides canvas rendering via `canvas.eval` (render live HTML/JS) and `canvas.reset` (clear), which is a separate rendering surface for agent-generated content — distinct from external web page automation.

## Claude Code Coverage

| Feature                    | Status  | Claude Code Primitive                                        |
|----------------------------|---------|--------------------------------------------------------------|
| Shell execution            | Yes     | `Bash` tool                                                  |
| File operations            | Yes     | `Read`, `Write`, `Edit`, `Glob`, `Grep` tools                |
| Web search                 | Yes     | `WebSearch` tool                                             |
| Web fetch                  | Yes     | `WebFetch` tool                                              |
| Browser automation         | Yes     | Multiple options — see detailed comparison below              |
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

### Browser Automation in Claude Code — Detailed Comparison

Claude Code offers **three complementary approaches** to browser automation, each at a different level:

| Approach | Type | How it works | Best for |
|----------|------|-------------|----------|
| **Playwright MCP** ([microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)) | MCP server | Reads accessibility tree (structured DOM, 2-5KB) — no screenshots needed | Fast, deterministic web automation; form filling, scraping, testing |
| **Computer Use** ([API docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)) | API tool | Takes screenshots, Claude counts pixels, moves mouse, clicks, types | Any GUI app (not just browsers); visual/spatial layouts |
| **Playwright Skill** ([lackeyjb/playwright-skill](https://github.com/lackeyjb/playwright-skill)) | Installable skill | Claude writes custom Playwright code, executes via `run.js` in visible browser | Maximum flexibility; complex multi-step workflows |

Additional options include [ExecuteAutomation's mcp-playwright](https://github.com/executeautomation/mcp-playwright) (143 device emulation profiles) and Puppeteer MCP.

#### OpenClaw `browser.action` vs Claude Code options

| Capability | OpenClaw `browser.action` | Claude Code Playwright MCP | Claude Code Computer Use |
|-----------|--------------------------|---------------------------|------------------------|
| Navigate URLs | Yes | Yes | Yes |
| Click elements | Yes | Yes (accessibility tree — deterministic) | Yes (pixel coordinates — visual) |
| Fill forms | Implied | Yes (structured element interaction) | Yes (keyboard typing) |
| Take screenshots | Yes | Yes | Yes (core mechanism) |
| Scrape content | Yes | Yes (structured accessibility data) | No (vision-based) |
| Device emulation | Not specified | Yes (mobile, tablet, desktop profiles) | No |
| Authentication | Not specified | Visible browser — user logs in manually | Same |
| Zero-config built-in | **Yes** | **No** — requires MCP server setup | **No** — requires Docker/VM, beta |
| Non-browser apps | No | No | **Yes** — any desktop GUI |
| Speed | Not specified | Fast (2-5KB snapshots, no vision) | Slow (500KB-2MB screenshots per step) |
| Cost | Not specified | Low (text-only tool calls) | High (vision model tokens per step) |

**Key finding:** Claude Code's Playwright MCP is **technically superior** to OpenClaw's `browser.action` — it uses structured accessibility trees instead of screenshots, is deterministic, and supports device emulation. However, OpenClaw wins on **ease of use** — `browser.action` is built-in with zero setup.

## Gaps

| Gap                          | Severity | Notes                                                                         |
|------------------------------|----------|-------------------------------------------------------------------------------|
| No **built-in** browser tool | MEDIUM   | Browser automation requires MCP server setup; not zero-config like OpenClaw's `browser.action` |
| No canvas/live HTML rendering | MEDIUM  | No equivalent to OpenClaw's `canvas.eval` for rendering agent-generated HTML/JS in-session |
| No camera/photo tools        | LOW      | Not typical for CLI agents; could add via MCP                                 |
| No GPS/location tools        | LOW      | Could integrate via MCP with device APIs                                      |
| No sandboxed shell isolation | MEDIUM   | Bash runs in user's environment; no container isolation                       |
| No tool versioning           | LOW      | Skills don't have version management                                          |
| No tool marketplace/registry | LOW      | No centralized discovery beyond MCP registry                                  |

## Build Recommendations

1. **Browser automation setup skill** — Create a `/browser-setup` skill or bash script that auto-installs and configures the Playwright MCP server (similar to how `auditlog.sh install` registers hooks). This would close the zero-config gap with OpenClaw's `browser.action`.
2. **Canvas rendering via MCP** — Build an MCP server wrapping a headless browser for rendering agent-generated HTML/JS content. This would replicate OpenClaw's `canvas.eval`/`canvas.reset`.
3. **Camera/location via MCP** — If needed, build lightweight MCP servers that interface with device APIs (e.g., `imagesnap` on macOS for camera, CoreLocation for GPS)
4. **Sandboxed execution** — Use Docker containers or macOS sandbox profiles for tool isolation:
   - MCP servers can run inside containers
   - Bash commands can be routed through a sandboxed executor
5. **Skill packaging** — Use the existing skills system as-is; it already supports project-level and user-level skill installation
6. **Tool registry** — The MCP registry already serves as a tool discovery mechanism; extend with a local catalog if needed

## Verdict

**GREEN/YELLOW** — Claude Code's tool and skill ecosystem is the closest match to OpenClaw's design. Browser automation via Playwright MCP is technically superior to OpenClaw's `browser.action` (structured accessibility trees vs unspecified implementation), but requires setup. The main gaps are: no zero-config browser tool (MEDIUM), no canvas/live HTML rendering (MEDIUM), and minor items (camera, location, sandboxing) addressable with targeted MCP servers.
