---
cron: "*/15 * * * *"
enabled: false
timeout: 120
description: "System health check — only invokes LLM when issues found"
sandbox: true
singleton: true
precheck: "df -h / | awk 'NR==2 && int($5)>90{print \"Disk usage: \"$5}'; if ! pgrep -x cron >/dev/null; then echo 'cron not running'; fi"
---

# System Health Check

The precheck script found issues that need your attention.
Review the precheck output above and:

1. Summarize what's wrong in plain language
2. Suggest a fix for each issue
3. Rate severity: LOW / MEDIUM / HIGH

Do NOT attempt to fix anything — only report.

## Safety guardrails
- Do NOT modify any files or system configuration
- Do NOT run destructive commands
- Do NOT restart services
- Only analyze and report on the precheck output
