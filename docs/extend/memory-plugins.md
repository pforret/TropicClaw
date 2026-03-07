# Memory MCP Plugins Setup

Two MCP servers are installed for TropicClaw to address the memory and identity persistence gaps.

## 1. claude-mem — General Memory

Hybrid semantic + keyword memory with auto-capture and progressive disclosure.

### Install

```bash
claude mcp add claude-mem -- npx -y claude-mem
```

### What it provides

- **Hybrid search**: Chroma vectors (semantic) + SQLite FTS5 (keyword)
- **Auto-capture**: 5 lifecycle hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd)
- **Progressive disclosure**: 3-layer retrieval (index → timeline → detail) for ~10x token savings
- **Web viewer**: Real-time memory stream at `http://localhost:37777`

### Addresses gaps

- Gap 05 (Memory): vector embeddings, semantic search, BM25, hybrid scoring, conversation indexing

### Links

- [GitHub](https://github.com/thedotmack/claude-mem)

## 2. claude-memory-mcp — Identity Persistence

File-based identity persistence with promotion scoring. Zero external dependencies.

### Install

```bash
claude mcp add identity -- npx -y @whenmoon-afk/memory-mcp
```

### What it provides

- **Three tools**: `reflect` (end-of-session analysis), `anchor` (write identity), `self` (query state)
- **Identity files**: `soul.md`, `self-state.md`, `identity-anchors.md`, `observations.json`
- **Auto-promotion**: Concepts promoted to anchors via `score = sqrt(recalls) * log2(days + 1) * diversity_bonus * recency`
- **Auto-pruning**: Single observations older than 30 days auto-prune
- **Zero-cost mode**: Can run via hooks only, consuming zero context tokens

### Addresses gaps

- Gap 07 (Persona): structured identity schema, soul/identity separation, template evolution tracking

### Links

- [GitHub](https://github.com/WhenMoon-afk/claude-memory-mcp)

## Verification

List installed MCP servers:

```bash
claude mcp list
```

Both should appear as `stdio` type servers.
