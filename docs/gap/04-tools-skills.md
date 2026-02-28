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

Claude Code offers **five complementary approaches** to browser automation, each at a different level:

| Approach | Type | How it works | Best for |
|----------|------|-------------|----------|
| **Claude in Chrome** (first-party) | Chrome extension | Accessibility tree with screenshot fallback; inherits user's browser sessions, cookies, auth | Interacting with authenticated web apps; visual workflows; GIF/workflow recording |
| **Playwright MCP** ([microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp)) | MCP server | Reads accessibility tree (structured DOM, 2-5KB) — no screenshots needed | Fast, deterministic web automation; form filling, scraping, testing |
| **Dev-Browser Skill** | Installable skill | Controls existing Chrome instance via ARIA snapshots; reuses user's logged-in browser | Testing/debugging web apps already open in Chrome |
| **Computer Use** ([API docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)) | API tool | Takes screenshots, Claude counts pixels, moves mouse, clicks, types | Any GUI app (not just browsers); visual/spatial layouts |
| **Playwright Skill** ([lackeyjb/playwright-skill](https://github.com/lackeyjb/playwright-skill)) | Installable skill | Claude writes custom Playwright code, executes via `run.js` in visible browser | Maximum flexibility; complex multi-step workflows |

Additional options include [ExecuteAutomation's mcp-playwright](https://github.com/executeautomation/mcp-playwright) (143 device emulation profiles), Puppeteer MCP, and web scraping skills (Firecrawl, Apify).

#### Claude in Chrome — First-Party Browser Integration

Claude in Chrome is Anthropic's first-party Chrome extension (launched August 2025, available on all paid plans by December 2025). Key capabilities:

- **Launch**: `claude --chrome` from CLI or `/chrome` slash command
- **Inherits browser sessions** — uses the user's existing cookies, auth tokens, logged-in state
- **Accessibility tree + screenshot fallback** — reads structured DOM by default, falls back to vision for complex layouts
- **GIF recording** — can record browser interactions as animated GIFs for documentation
- **Workflow recording** — captures multi-step browser workflows for replay
- **No separate server setup** — connects directly to Chrome via extension

This is the closest Claude Code equivalent to OpenClaw's zero-config `browser.action` — it's built-in, requires minimal setup (just the Chrome extension), and provides both structured and visual browser interaction.

#### OpenClaw `browser.action` vs Claude Code options

| Capability | OpenClaw `browser.action` | Claude in Chrome | Playwright MCP | Computer Use |
|-----------|--------------------------|-----------------|----------------|--------------|
| Navigate URLs | Yes | Yes | Yes | Yes |
| Click elements | Yes | Yes (a11y tree + visual fallback) | Yes (a11y tree — deterministic) | Yes (pixel coords — visual) |
| Fill forms | Implied | Yes (inherits auth/sessions) | Yes (structured interaction) | Yes (keyboard typing) |
| Take screenshots | Yes | Yes (with GIF recording) | Yes | Yes (core mechanism) |
| Scrape content | Yes | Yes (structured + visual) | Yes (structured a11y data) | No (vision-based) |
| Device emulation | Not specified | No (uses real Chrome) | Yes (mobile/tablet/desktop) | No |
| Authentication | Not specified | **Yes** — inherits user's sessions | Visible browser — manual login | Same |
| Zero-config built-in | **Yes** | **Near-zero** — Chrome extension only | **No** — MCP server setup | **No** — Docker/VM, beta |
| Non-browser apps | No | No | No | **Yes** — any desktop GUI |
| Speed | Not specified | Medium (a11y tree + occasional screenshots) | Fast (2-5KB, no vision) | Slow (500KB-2MB per step) |
| Cost | Not specified | Medium (text + occasional vision) | Low (text-only) | High (vision tokens per step) |

**Key finding:** Claude Code now has **near-parity** with OpenClaw's `browser.action` via **Claude in Chrome** — a first-party Chrome extension that inherits browser sessions, uses accessibility trees with screenshot fallback, and requires minimal setup (just the extension). For headless/automated scenarios, **Playwright MCP** remains the most efficient option. The zero-config gap is largely closed by Claude in Chrome for interactive use cases.

## Gaps

| Gap                          | Severity | Notes                                                                         |
|------------------------------|----------|-------------------------------------------------------------------------------|
| No **built-in** browser tool | LOW      | Largely addressed by Claude in Chrome (first-party extension); headless automation still requires MCP setup |
| No canvas/live HTML rendering | MEDIUM  | No equivalent to OpenClaw's `canvas.eval` — see [Web App Generation](08-web-app-generation.md) for detailed analysis |
| No camera/photo tools        | LOW      | Not typical for CLI agents; could add via MCP                                 |
| No GPS/location tools        | LOW      | Could integrate via MCP with device APIs                                      |
| No sandboxed shell isolation | MEDIUM   | Bash runs in user's environment; no container isolation                       |
| No tool versioning           | LOW      | Skills don't have version management                                          |
| No tool marketplace/registry | LOW      | No centralized discovery beyond MCP registry                                  |

## Build Recommendations

1. **Browser automation setup skill** — Create a `/browser-setup` skill or bash script that auto-installs and configures the Playwright MCP server (similar to how `auditlog.sh install` registers hooks). This would close the zero-config gap with OpenClaw's `browser.action`.
2. **Canvas rendering via MCP** — Build a Canvas MCP server with HTTP + WebSocket for live rendering of agent-generated content. See [Web App Generation gap analysis](08-web-app-generation.md) for detailed design.
3. **Camera/location via MCP** — If needed, build lightweight MCP servers that interface with device APIs (e.g., `imagesnap` on macOS for camera, CoreLocation for GPS)
4. **Sandboxed execution** — Use Docker containers or macOS sandbox profiles for tool isolation:
   - MCP servers can run inside containers
   - Bash commands can be routed through a sandboxed executor
5. **Skill packaging** — Use the existing skills system as-is; it already supports project-level and user-level skill installation
6. **Tool registry** — The MCP registry already serves as a tool discovery mechanism; extend with a local catalog if needed

## Verdict

**GREEN/YELLOW** — Claude Code's tool and skill ecosystem is the closest match to OpenClaw's design. Browser automation is now near-parity: Claude in Chrome provides first-party, near-zero-config browser interaction (comparable to OpenClaw's `browser.action`), while Playwright MCP offers superior headless automation with accessibility trees. The remaining gaps are: no canvas/live HTML rendering (MEDIUM — see [Web App Generation](08-web-app-generation.md) for detailed analysis), and minor items (camera, location, sandboxing) addressable with targeted MCP servers.
