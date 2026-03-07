---
cron: "*/30 * * * *"
enabled: false
timeout: 180
description: "Check email — only invokes LLM when new unread messages arrive"
sandbox: true
singleton: true
memory: true
precheck: ".claude/cronbot/cli-changed.sh mail-unread 'notmuch search --format=json tag:unread date:today.. 2>/dev/null | jq -r \".[] | \\\"[\\(.date_relative)] \\(.authors) — \\(.subject)\\\"\" | head -50'"
---

# Email Triage

New unread emails have arrived. Review the precheck output above and:

1. **Categorize** each message: urgent / actionable / informational / spam-likely
2. **Summarize** actionable items in one line each
3. **Flag** anything that looks time-sensitive

If you have memory from previous runs, note which senders or threads are recurring.

## Safety guardrails
- Do NOT send, reply to, or modify any emails
- Do NOT run any shell commands
- Do NOT access any files except your memory file
- Only analyze and categorize the email subjects/senders provided
