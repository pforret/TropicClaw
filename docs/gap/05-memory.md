# Gap Analysis: Memory Subsystem

## OpenClaw Feature

OpenClaw's memory system provides persistent, searchable context with a **two-level architecture**:

### Level 1: Bootstrap (Injected Every Time)

Every time the agent runs, Gateway reads these workspace files and injects them into context **before** the LLM sees the user's message:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Operating manual — how to think, when to use which tool, safety rules |
| `SOUL.md` | Personality — tone, boundaries, priorities |
| `USER.md` | User profile — name, preferences, context |
| `IDENTITY.md` | Name, creature type, vibe, emoji |
| `YYYY-MM-DD.md` | Today's daily log — tasks in progress, what was discussed |

**Trade-off**: Bootstrap files eat tokens on every single request. The more content in bootstrap, the more expensive each call.

### Level 2: Semantic Search (On-Demand)

When the memory plugin is enabled, the agent searches `MEMORY.md` and other notes via a vector index — finds relevant chunks by meaning, not keywords. Only pulls what's relevant to the current query; doesn't burn context constantly.

**Strategy**: Put critical stuff in bootstrap (tone, rules, who you are). Everything else goes into `MEMORY.md` and daily logs for semantic retrieval.

### Storage Format

Everything is **text files** — `.md` and `.json`, no database:

- **Session history**: `.jsonl` per conversation (append-only)
- **Session index**: `sessions.json`
- **Workspace files**: `.md` files (AGENTS.md, SOUL.md, etc.)
- **Long-term memory**: `MEMORY.md` — facts the agent writes on its own or when instructed
- **Daily logs**: `YYYY-MM-DD.md` — what happened today, carried into tomorrow

### Full Feature List

- **Vector embeddings** for semantic similarity search
- **Hybrid search**: BM25 (keyword) + vector similarity, combined scoring
- **Scoped filtering**: Filter memories by agent, channel, user, time range, tags
- **Conversation indexing**: Past conversations are indexed and retrievable
- **Memory lifecycle**: Create, update, expire, delete memories
- **Contextual injection**: Relevant memories automatically included in agent prompts

### Compaction Risk

Long dialogues grow into thousands of tokens. If the agent didn't write important decisions to `MEMORY.md` **before** compression/compaction, they're gone permanently. Fix: enable memory flush before compaction.

## Claude Code Coverage

| Feature                   | Status  | Claude Code Primitive                                               |
|---------------------------|---------|---------------------------------------------------------------------|
| Static persistent context | Yes     | `CLAUDE.md` files, auto-memory directory                            |
| Session memory            | Yes     | Context window (auto-compressed)                                    |
| Session resume            | Yes     | `--resume`, `--continue` flags                                      |
| Cross-session persistence | Partial | Auto-memory files in `~/.claude/projects/`                          |
| Semantic search           | No      | —                                                                   |
| Vector embeddings         | No      | —                                                                   |
| BM25/keyword search       | No      | —                                                                   |
| Scoped filtering          | No      | —                                                                   |
| Conversation indexing     | No      | —                                                                   |
| Memory lifecycle          | Partial | Can write/edit memory files, but no expiry or structured management |

**What works:**
- `CLAUDE.md` provides static context loaded at session start
- Auto-memory directory (`~/.claude/projects/<project>/memory/`) persists notes across sessions
- `--resume` continues a previous session with full context
- Within a session, the full conversation is available (with auto-compression for long sessions)

## Gaps

| Gap                               | Severity | Notes                                             |
|-----------------------------------|----------|---------------------------------------------------|
| No vector embeddings              | HIGH     | Cannot do semantic similarity search              |
| No semantic search                | HIGH     | Memory retrieval is file-based, not content-based |
| No BM25/keyword search            | MEDIUM   | No full-text search across memories               |
| No hybrid search scoring          | HIGH     | Core feature of OpenClaw memory                   |
| No scoped filtering               | HIGH     | Cannot filter by agent, channel, user, time       |
| No conversation indexing          | MEDIUM   | Past sessions not searchable                      |
| No memory expiry/lifecycle        | LOW      | Memories persist until manually deleted           |
| No automatic contextual injection | MEDIUM   | Must manually reference memory files              |
| No compaction-safe memory flush   | MEDIUM   | Claude Code auto-compresses long sessions; no mechanism to flush important context to persistent storage before compression |
| No daily log convention           | LOW      | No equivalent to OpenClaw's `YYYY-MM-DD.md` daily context files |

## Existing MCP Plugins

Several community MCP servers already address the memory gaps. Two have been installed for TropicClaw:

### Installed: claude-mem (general memory)

- **Package**: `npx -y claude-mem`
- **Stars**: ~33k on GitHub
- **Approach**: Hybrid semantic (Chroma vectors) + keyword (SQLite FTS5)
- **Memory tiers**: 3-layer progressive disclosure (index → timeline → detail), ~10x token savings
- **Capture**: Automatic via 5 lifecycle hooks (SessionStart, PostToolUse, Stop, etc.)
- **Stack**: TypeScript, SQLite + Chroma, web viewer on :37777
- **Install**: `claude mcp add claude-mem -- npx -y claude-mem`

**OpenClaw gap coverage**:

| Gap | Covered? |
|-----|----------|
| Vector embeddings | Yes (Chroma) |
| Semantic search | Yes |
| BM25/keyword search | Yes (FTS5) |
| Hybrid search scoring | Yes |
| Scoped filtering | Partial |
| Conversation indexing | Yes (auto-capture) |
| Auto contextual injection | Yes (progressive disclosure) |
| Compaction-safe flush | Partial (hook-based capture) |

### Other Notable MCP Memory Servers

| Server | Stars | Approach | Standout Feature |
|--------|-------|----------|------------------|
| [mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | ~1.5k | Knowledge graph + BM25 + vector | Typed edges (causes/fixes/contradicts), 5ms retrieval |
| [mcp-server-qdrant](https://github.com/qdrant/mcp-server-qdrant) | ~1.3k | Qdrant vector DB | Official, production-grade, simple store/find API |
| [Vector Memory MCP](https://lobehub.com/mcp/cornebidouil-vector-memory-mcp) | — | sqlite-vec + sentence-transformers | Zero external DB dependencies |
| [Codebase Memory MCP](https://lobehub.com/mcp/normcrandall-codebase-memory-mcp-server) | — | LanceDB + Ollama | Multi-repo scoped memories |
| [MemCP](https://dev.to/dalimay28/how-i-built-memcp-giving-claude-a-real-memory-15co) | — | Embeddings with auto-fallback | 20x token savings vs raw loading |
| [mem0 self-hosted](https://dev.to/n3rdh4ck3r/how-to-give-claude-code-persistent-memory-with-a-self-hosted-mem0-mcp-server-h68) | — | Qdrant + Ollama + Neo4j | Full knowledge graph, fully local |

## Build Recommendations

With claude-mem installed, the remaining work is:

1. **Scoped filtering** — Extend or configure claude-mem to filter by agent, channel, user, and time range (needed for multi-agent)
2. **Memory lifecycle** — Add expiry/deletion policies on top of claude-mem's storage
3. **Daily log convention** — Adopt `YYYY-MM-DD.md` convention; hook into claude-mem's SessionEnd to auto-generate
4. **Conversation indexing** — claude-mem's auto-capture covers this; verify coverage depth
5. **Compaction-safe flush** — Add a pre-compaction hook to persist critical context to claude-mem before Claude Code's auto-compression

### Suggested Architecture

```
┌────────────────┐     MCP      ┌──────────────────┐
│ Claude Code    │◄────────────►│  claude-mem      │
│  (agent)       │              │  ├─ Chroma (vec) │
└────────────────┘              │  ├─ SQLite FTS5  │
                                │  └─ web viewer   │
                                └──────────────────┘
```

## Verdict

**YELLOW** — With claude-mem installed, the memory subsystem moves from RED to YELLOW. Hybrid semantic+keyword search, auto-capture via hooks, and progressive disclosure are now available. Remaining gaps are scoped filtering (multi-agent/channel), memory lifecycle management, and compaction-safe flushing.
