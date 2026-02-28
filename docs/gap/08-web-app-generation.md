# Gap Analysis: Web App Generation & Live Rendering

## OpenClaw Feature

OpenClaw provides a **Canvas + A2UI (Agent-to-UI)** system that lets agents generate and serve interactive web interfaces to users in real time:

### Canvas Server

- **Separate server process** — runs independently from the main Gateway, defaults to port 18793
- **WebSocket-based** — agent pushes HTML/UI updates, Canvas server broadcasts to connected browser clients
- **Crash isolation** — if Canvas crashes, the Gateway continues normally
- **Security boundary** — Canvas serves agent-writable content in a separate security context
- **Custom scheme** — local canvas content uses a custom URL scheme (no loopback server needed), with directory traversal blocked

### canvas.eval — Full JavaScript Evaluation

`canvas.eval` is not a simple HTML snippet renderer — it is a **full JavaScript evaluation engine** operating on a live WebView (WKWebView on macOS, WebView on Android, browser tab on web). The agent can:

- **Manipulate the DOM**: `document.body.style.background='blue'`
- **Draw on Canvas 2D**: Use `window.__openclaw` context for shapes, charts, diagrams
- **Query page state**: `document.title`, `location.href` — read current state and return results to the agent
- **Inject entire apps**: Load Chart.js, D3.js, or any library; set up event handlers; build full interactive UIs

The tool signature: `openclaw nodes invoke --node <nodeId> --command canvas.eval --params '{"javaScript":"<code>"}'`

### A2UI (Agent-to-UI) Format

A2UI is an **open standard developed by Google** (Apache 2.0 licensed) that OpenClaw vendors into its codebase. It is a declarative data format optimized for agent-generated UIs:

| Property | Description |
|----------|-------------|
| **Security-first** | Declarative, not executable code. Clients maintain a "catalog" of trusted, pre-approved UI components (Card, Button, TextField). Agents can only request components from the catalog — eliminating injection attacks. |
| **LLM-friendly** | Flat list of components with ID references. Easy for LLMs to generate incrementally, enabling progressive rendering. |
| **Framework-agnostic** | Same A2UI JSON renders on web components, Flutter widgets, React components, SwiftUI views, or any other framework. |
| **Incremental updates** | Agent makes surgical changes to the UI as the conversation progresses. |
| **Interactive** | Buttons with `a2ui-action` attributes send action events back through the canvas server to the agent as tool calls. Enables multi-step forms, surveys, configuration wizards. |

**A2UI status:** v0.8 (Public Preview). Roadmap includes official React, Jetpack Compose, and SwiftUI renderers.

### Content Delivery Architecture

OpenClaw Canvas has **two content delivery paths**:

```
+------------------+       WebSocket/JSON-RPC        +------------------+
|                  | <-----------------------------> |                  |
|   Agent Runtime  |    canvas.eval (JS via WS)      |  Gateway Server  |
|   (LLM + Tools)  |    canvas.navigate              |  (port 18789)    |
|                  |    canvas.a2ui.* (JSON)          |                  |
+------------------+                                  +--------+---------+
                                                               |
                                        HTTP: /__openclaw__/canvas/
                                        Custom scheme: openclaw-canvas://
                                                               |
                                                      +--------v---------+
                                                      |  Client WebView  |
                                                      |  (WKWebView /    |
                                                      |   WebView /      |
                                                      |   Browser Tab)   |
                                                      +------------------+
```

1. **`canvas.eval` path** (WebSocket): JavaScript sent to the node's WebView for evaluation. Works through proxies. Lower-level, more flexible, less secure.
2. **A2UI path** (HTTP + WebSocket): Declarative JSON rendered via the Gateway's canvas host at `localhost:18789/__openclaw__/canvas/`. More secure (component catalog), but requires direct HTTP connectivity.

**File serving:** Canvas files stored at `~/Library/Application Support/OpenClaw/canvas/<session>/...` (macOS). The custom `openclaw-canvas://` scheme maps paths to local files. **Live reload**: the panel auto-reloads when local canvas files change.

### Platform Support

| Platform | How Canvas renders |
|----------|-------------------|
| **macOS** | Embedded WKWebView panel in the macOS app |
| **Telegram** | Mini App within the Telegram chat |
| **Android** | Native canvas runtime with `node.canvas.capability.refresh` |
| **Web** | Standard browser rendering via WebSocket connection |

### Canvas Tools

| Tool | Purpose |
|------|---------|
| `canvas.eval` | Execute JavaScript / render HTML+A2UI in the canvas context |
| `canvas.reset` | Clear the canvas |
| `canvas.present` | Present/show the canvas panel |
| `canvas.navigate` | Navigate the canvas to a URL |
| `canvas.snapshot` | Take a screenshot of the canvas content |

### What Canvas Can Render

- **Interactive dashboards** — real-time data displays, charts, status panels
- **Forms and workflows** — structured input UIs (A2UI: Button, TextField, etc.)
- **Diagrams and logs** — agent-generated visualizations that update live
- **Small web apps** — to-do lists, calculators, simple utilities
- **Debugging output** — structured logs, planning views, task progress

### What Canvas Is NOT

- **Not a full web app hosting platform** — Canvas renders agent-generated content within the client, not as a standalone hosted website. However, the agent can separately use shell tools to scaffold and run standalone web servers on arbitrary ports.
- **Not persistent** — content is session-scoped; it doesn't survive across sessions by default
- **Not a web framework** — there's no build pipeline, routing, or database; it's a rendering surface
- **Not a replacement for web app development** — for production apps (dashboards, SaaS), the agent would use shell tools to build a proper app; Canvas is for in-session visual output

## Claude Code Coverage

### What Claude Code CAN Do

Claude Code can **generate complete web applications** — it writes code for full-stack apps using any framework (React, Next.js, Vite, Express, etc.) and can start development servers:

| Capability | How | Status |
|-----------|-----|--------|
| Generate full-stack web apps | Writes HTML/CSS/JS/React/Next.js code via file tools | **Yes** |
| Start dev servers | `npm run dev`, `vite`, `python -m http.server` via Bash tool | **Yes** |
| Test running apps | Claude in Chrome / Dev Browser Skill to verify at localhost | **Yes** |
| Deploy to hosting | Push to Vercel, Cloudflare, Railway via CLI tools | **Yes** |
| Connect to dev servers | Next.js DevTools MCP connects to running Next.js at `localhost:3000/_next/mcp` | **Yes** |
| Inline HTML preview | Claude.ai Artifacts render HTML/JS/React in sandboxed iframe | **Partial** (web only, not CLI) |
| Background dev servers | `Ctrl+B` or `run_in_background` to run servers while continuing work | **Yes** (CLI/Desktop only) |
| Iterative verify loop | Generate code → start server → Chrome verify → fix → repeat | **Yes** (via Claude in Chrome) |

### What Claude Code CANNOT Do

| Capability | Gap | Notes |
|-----------|-----|-------|
| Agent-driven live UI rendering | **No canvas equivalent** | No built-in rendering surface where Claude can push live UI updates |
| A2UI-style declarative UI | **No equivalent** | No component catalog, no incremental UI updates |
| In-session visual workspace | **No equivalent** | Claude Code CLI is text-only; no embedded visual panel |
| WebSocket-based UI push | **No equivalent** | Claude can't push real-time visual updates to a connected client |
| Cross-platform UI rendering | **No equivalent** | No framework-agnostic UI format that works across macOS, mobile, Telegram |

### Existing Partial Solutions

| Approach | What it provides | Limitations |
|----------|-----------------|-------------|
| **Claude.ai Artifacts** | Inline HTML/JS/React preview in sandboxed iframe | Only on claude.ai web UI, not CLI. Can't make external API calls. Not accessible as a standalone URL. |
| **Bash `npm run dev`** | Starts dev server, app available at localhost:port | Manual workflow — Claude generates code, starts server, but no integrated preview. User must open browser separately. |
| **Claude in Chrome** | Claude can view/interact with the running app | For testing, not for rendering agent-generated content to users |
| **Dev Browser Skill** | "Open localhost:3000 and verify the signup flow" | Testing tool, not a rendering surface |
| **Community web UIs** | claude-code-webui, claude-code-web, etc. | Chat interfaces, not canvas-style rendering surfaces |

**Important limitation:** Claude Code on the Web (cloud sandbox) **cannot bind to network ports** — it can *generate* web apps but cannot *serve* them. Generated code must be pulled via git and run locally. Only the CLI/Desktop version can start dev servers.

## Gap Analysis

| Gap | Severity | Notes |
|-----|----------|-------|
| No agent-driven live UI canvas | **HIGH** | Core OpenClaw feature — agent pushes real-time visual content to user. No Claude Code equivalent. |
| No A2UI declarative UI format | **MEDIUM** | Agent-to-UI is a differentiating OpenClaw feature. Claude Code has no component catalog or incremental UI system. |
| No integrated web app preview in CLI | **MEDIUM** | Claude Code CLI is text-only. Claude.ai has Artifacts but not accessible from CLI/API workflows. |
| No WebSocket-based UI push | **MEDIUM** | Claude Code can't push live visual updates to connected clients. |
| No cross-platform UI rendering | **LOW** | Only relevant for multi-platform deployments (macOS, mobile, Telegram) |
| Web app generation itself works | **N/A** | Claude Code excels at building full-stack web apps — the gap is in serving/previewing them, not creating them |

## Build Recommendations

### 1. Canvas MCP Server (HIGH priority)

Build an MCP server that provides a live rendering surface for Claude-generated content:

```
Architecture:
  Claude Code ──(MCP tools)──→ Canvas MCP Server ──(WebSocket)──→ Browser clients
                                    ├── canvas.eval (render HTML/JS)
                                    ├── canvas.reset (clear)
                                    ├── canvas.push (A2UI-style component update)
                                    └── canvas.snapshot (screenshot)
```

**Implementation approach:**
- MCP server wrapping a lightweight HTTP + WebSocket server (e.g., Express + ws)
- Serves a thin client page at `localhost:PORT` that connects via WebSocket
- When Claude calls `mcp__canvas__eval`, the server pushes content to connected browsers
- Hot-reload: each `canvas.eval` call updates the page without full refresh
- Security: content runs in a sandboxed iframe, same-origin restrictions apply

**Tools exposed:**
- `mcp__canvas__eval` — Render HTML/JS/CSS content in the canvas
- `mcp__canvas__reset` — Clear the canvas
- `mcp__canvas__push` — Push a UI component update (A2UI-compatible JSON)
- `mcp__canvas__snapshot` — Take a screenshot (returns base64 image)
- `mcp__canvas__open` — Open the canvas URL in the default browser

### 2. Web App Scaffolder Skill (MEDIUM priority)

A `/webapp` skill that scaffolds a complete web application and starts serving it:

```
/webapp todo-app
```

Would:
1. Scaffold a project (Vite + React, or plain HTML/JS)
2. Generate the initial code based on the user's description
3. Start the dev server (`vite --port <PORT>`)
4. Open the browser (if Claude in Chrome available) or print the URL
5. Allow iterative development — Claude modifies code, browser hot-reloads

This doesn't replicate Canvas but provides a practical workflow for "Claude builds web app → user accesses it."

### 3. A2UI-Compatible Component Renderer (LOW priority, future)

A2UI is a [Google open standard](https://github.com/google/A2UI) (Apache 2.0) — not OpenClaw-specific. If the Canvas MCP server proves useful, extend it with an A2UI-compatible renderer:
- Use the official A2UI JSON schema for UI components (Card, Button, TextField, List, Chart, etc.)
- Render them as web components or React components in the Canvas MCP client
- Support `a2ui-action` attributes for interactive callbacks (button clicks → agent tool calls)
- Allow incremental updates (patch by component ID)
- This would achieve near-parity with OpenClaw's A2UI system and could leverage A2UI's planned official renderers

## Comparison: OpenClaw Canvas vs Claude Code Approaches

| Feature | OpenClaw Canvas | Claude Code + Canvas MCP (proposed) | Claude Code Current |
|---------|----------------|--------------------------------------|-------------------|
| Agent pushes live UI | **Yes** — built-in | **Yes** — via MCP server | **No** |
| Declarative UI (A2UI) | **Yes** — component catalog | Possible — extensible | **No** |
| In-session visual panel | **Yes** — embedded in client | **Yes** — browser tab at localhost | **No** (CLI is text-only) |
| Full web app generation | Basic (canvas-scoped) | **Yes** — full-stack with any framework | **Yes** — Claude Code excels here |
| Persistent web apps | **No** — session-scoped | **Yes** — generated apps persist as files | **Yes** — files on disk |
| Deploy to production | **No** | **Yes** — push to Vercel, Cloudflare, etc. | **Yes** |
| Cross-platform rendering | **Yes** — macOS, Telegram, Android | **No** — browser only | **No** |
| Hot-reload development | Via WebSocket push | Via Vite/Next.js HMR + MCP integration | Via Vite/Next.js HMR (manual) |

## Verdict

**YELLOW/RED** — Claude Code is significantly stronger than OpenClaw at **generating full web applications** (complete full-stack apps with any framework, deployment to production hosting). However, Claude Code has **no equivalent to OpenClaw's Canvas + A2UI** — the ability for the agent to push real-time visual content to a connected client as a live rendering surface. This is a fundamentally different capability from "building and deploying web apps."

The practical impact depends on use case:
- **Building production web apps** (dashboards, to-do apps, SaaS products): Claude Code is **superior** — it generates complete, deployable applications
- **Agent-driven live UI** (in-session dashboards, interactive debugging views, real-time status displays): Claude Code has **no equivalent** — this requires building a Canvas MCP server
- **Quick visual output** (charts, diagrams, formatted data): Claude.ai Artifacts partially cover this on the web, but not in CLI workflows

A Canvas MCP server is the recommended solution — it would provide OpenClaw-like live rendering while leveraging Claude Code's superior web app generation capabilities.
