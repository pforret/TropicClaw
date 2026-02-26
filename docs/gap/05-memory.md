# Gap Analysis: Memory Subsystem

## OpenClaw Feature

OpenClaw's memory system provides persistent, searchable context:

- **Vector embeddings** for semantic similarity search
- **Hybrid search**: BM25 (keyword) + vector similarity, combined scoring
- **Scoped filtering**: Filter memories by agent, channel, user, time range, tags
- **Conversation indexing**: Past conversations are indexed and retrievable
- **Memory lifecycle**: Create, update, expire, delete memories
- **Contextual injection**: Relevant memories automatically included in agent prompts

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

## Build Recommendations

1. **Vector database via MCP** — Build or integrate an MCP server wrapping a vector DB:
   - **Lightweight**: ChromaDB, LanceDB, or SQLite-VSS for local/embedded use
   - **Scalable**: Qdrant, Weaviate, or Pinecone for production
   - MCP tools: `memory_store`, `memory_search`, `memory_delete`, `memory_list`
2. **Embedding generation** — Use Claude's or OpenAI's embedding API, or local models (e.g., `sentence-transformers`) for generating vectors
3. **Hybrid search** — Combine BM25 (via SQLite FTS5 or Tantivy) with vector similarity in the MCP server
4. **Scoped filtering** — Store metadata (agent, channel, user, timestamp, tags) alongside each memory entry; filter at query time
5. **Conversation indexing** — Post-session hook that summarizes and indexes the conversation into the memory store
6. **Auto-injection** — Pre-session hook or `CLAUDE.md` template that queries relevant memories and injects them into the system prompt

### Suggested Architecture

```
┌────────-─────┐     MCP      ┌──────────────────┐
│ Claude Code  │◄────────────►│  memory-mcp      │
│  (agent)     │              │  ├─ embeddings   │
└──────────-───┘              │  ├─ vector store │
                              │  ├─ BM25 index   │
                              │  └─ metadata DB  │
                              └──────────────────┘
```

## Verdict

**RED** — The memory subsystem is the widest gap. Claude Code's file-based memory (`CLAUDE.md`, auto-memory) provides basic persistence but none of the semantic search, hybrid retrieval, or scoped filtering that OpenClaw requires. A dedicated memory MCP server must be built, likely the highest-priority custom component.
