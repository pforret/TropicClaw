---
cron: "0 */6 * * *"
enabled: false
timeout: 120
description: "Monitor a URL for changes — only invokes LLM when content differs"
sandbox: true
singleton: true
precheck: ".claude/cronbot/url-changed.sh https://docs.anthropic.com/en/docs/claude-code/overview"
---

# URL Change Monitor

The monitored URL has changed since the last check.
Review the precheck output above (diff + previous/current content) and:

1. **Summarize** what changed in 3-5 bullet points
2. **Highlight** any breaking changes, deprecations, or new features
3. **Rate impact**: LOW (cosmetic/typos) / MEDIUM (new features) / HIGH (breaking changes)

Keep your response concise and actionable.

## Safety guardrails
- Do NOT modify any files
- Do NOT access any other URLs or resources
- Do NOT run any shell commands
- Only analyze the content provided in the precheck output
