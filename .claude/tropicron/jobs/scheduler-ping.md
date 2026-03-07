---
cron: "*/5 * * * *"
enabled: true
timeout: 10
description: "Scheduler heartbeat — write timestamp (no LLM)"
singleton: true
run: "date +%s > gateway/data/scheduler-ping.txt"
workdir: "/Users/pforret/Code/AI/TropicClaw"
---
