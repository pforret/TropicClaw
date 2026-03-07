---
cron: "0 3 * * *"
agent: main
session: true
description: "Nightly dreaming — compress history, consolidate learnings"
memory: true
singleton: true
timeout: 600
---

# Dreaming

You are performing nightly maintenance on your own memory and session.

1. Review today's conversation history (all channels)
2. Extract key decisions, facts, preferences, and action items
3. Write durable knowledge to your memory systems:
   - Use the `reflect` tool to analyze identity patterns
   - Use memory tools to store important facts
   - If you learned something about how to work better, update your CLAUDE.md
4. Evolve your persona files if warranted:
   - SOUL.md — refine if you discovered better communication approaches
   - USER.md — add newly learned user preferences, habits, context
   - TOOLS.md — update if new devices, hosts, or infra were mentioned
   - Use the `anchor` tool to promote recurring patterns to identity anchors
5. If you made ANY changes to personality, memory, or persona files:
   - Write a dream log to dreams/YYYY-MM-DD.md documenting what changed and why
   - Include a "## Changes" section listing each file modified with a one-line rationale
   - If nothing changed, skip the dream log (no empty dreams)
6. Delete dream logs older than 365 days from dreams/
7. The gateway will compress old messages after you finish

Keep the digest concise. Focus on what matters for tomorrow.

## Dream log format

```markdown
# Dream: YYYY-MM-DD

## Summary
One-paragraph digest of today's conversations.

## Changes
- `SOUL.md`: added preference for bullet-point responses (user asked 3x)
- `USER.md`: learned user timezone is CET
- `claude-mem`: stored 2 new facts about project X

## Action items carried forward
- [ ] Follow up on deployment issue from Slack
```

## Safety guardrails
- Do NOT delete any files except your own dream logs (and only those older than 365 days)
- Do NOT modify CLAUDE.md or persona files unless you have a specific, evidence-based improvement
- Do NOT send messages to any channel
- Persona changes must be small and incremental — no personality rewrites
- Do NOT run git push, git reset, or any destructive commands
- Do NOT access external APIs or network resources beyond memory tools
