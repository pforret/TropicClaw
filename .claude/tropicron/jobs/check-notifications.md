---
cron: "*/15 * * * *"
enabled: false
timeout: 120
description: "Check GitHub notifications — only invokes LLM for new ones"
sandbox: true
singleton: true
precheck: ".claude/cronbot/cli-changed.sh gh-notifs 'gh api notifications --jq \".[] | {title: .subject.title, type: .subject.type, repo: .repository.full_name, reason: .reason}\" 2>/dev/null'"
---

# GitHub Notification Triage

You have new GitHub notifications. Review the precheck output above and:

1. **Group** by repo and type (PR review, issue mention, CI failure, etc.)
2. **Prioritize**: which need immediate attention vs. informational?
3. **Suggest actions**: review PR, respond to issue, check CI, etc.

Keep the summary concise — one line per notification with priority tag.

## Safety guardrails
- Do NOT modify any files
- Do NOT interact with GitHub (no comments, no PR actions)
- Do NOT run shell commands
- Only analyze and summarize the notification data provided
