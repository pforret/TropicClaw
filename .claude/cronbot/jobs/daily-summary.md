---
cron: "0 9 * * MON-FRI"
enabled: false
timeout: 300
description: "Summarize today's tasks and priorities"
singleton: true
memory: true
notify_on_failure: "echo \"$(date +%Y-%m-%dT%H:%M) FAIL: $JOB_NAME - $JOB_ERROR\" >> $HOME/log/cronbot/notifications.log"
---

# Daily Summary

Check available context and summarize today's priorities.

1. Review any recent git activity in the current project
2. Check for pending TODOs or issues
3. Write a brief summary to ~/daily-briefing.md

Keep the summary concise — bullet points, not prose.

## Safety guardrails
- Do NOT delete or overwrite any existing files (only create/append)
- Do NOT run any git push, git reset, or destructive commands
- Do NOT access external APIs or network resources
- If you encounter an error, log it and move on
- If unsure about an action, skip it and note it in the summary
