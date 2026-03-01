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

## Learning Loops (Memory Feedback Stage)

Beyond storage and retrieval, OpenClaw's memory includes a **learning loop** — a feedback stage where the agent processes its own experiences and writes improved knowledge back to the memory store. This is what makes the agent get better over time.

### The Loop

```
Session → Post-session hook → Evaluate → Extract → Store → Pre-session injection → Next session
```

| Stage | What happens |
|---|---|
| **Summarize** | Compress the session into key facts, decisions, outcomes |
| **Evaluate** | Did the agent perform well? Were there errors, dead ends, or user corrections? |
| **Extract** | Identify reusable knowledge: patterns, user preferences, tool quirks, domain facts |
| **Classify** | Tag extracted knowledge by type (fact, preference, procedure, correction) and scope (user, project, global) |
| **Store** | Write to memory store with embeddings and metadata for future retrieval |
| **Prune** | Update or expire outdated memories that conflict with new knowledge |

### What This Enables

- **Self-correction** — agent notices recurring mistakes and writes a note to avoid them
- **Preference learning** — "user always wants TypeScript, not JavaScript" gets stored after 2-3 corrections
- **Domain accumulation** — facts about the codebase, APIs, and infrastructure build up over sessions
- **Tool mastery** — agent records which approaches worked/failed for specific tool combinations

### Claude Code Coverage

| Feature | Status | Notes |
|---|---|---|
| Post-session processing | Partial | `Stop` hook can trigger post-session scripts |
| Session summarization | No | No built-in summarizer; must be custom |
| Self-evaluation | No | Agent cannot review its own past performance |
| Knowledge extraction | No | No structured extraction pipeline |
| Memory update/prune | Partial | Can edit auto-memory files, but no conflict resolution |

### Implementation

The learning loop is a **scheduled job** (see [06-self-scheduling.md](06-self-scheduling.md)) that runs post-session or on a daily schedule:

1. **Post-session hook** triggers a `claude -p` call with the session log (from tropiclog)
2. The learning agent summarizes, evaluates, and extracts knowledge
3. Extracted knowledge is written to the memory MCP server with appropriate metadata
4. A nightly "consolidation" job merges, deduplicates, and prunes the memory store

This connects self-scheduling (mechanism) → memory (storage) → agent runtime (improved prompts).

## Verdict

**RED** — The memory subsystem is the widest gap. Claude Code's file-based memory (`CLAUDE.md`, auto-memory) provides basic persistence but none of the semantic search, hybrid retrieval, scoped filtering, or learning loops that OpenClaw requires. A dedicated memory MCP server must be built, likely the highest-priority custom component. The learning loop adds a feedback stage that transforms memory from passive storage into active self-improvement.
