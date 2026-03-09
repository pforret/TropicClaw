---
cron: "0 4 * * *"
enabled: true
timeout: 120
singleton: true
description: "Nightly git pull and gateway restart at 4:00am"
---

# Nightly Update

Run the following shell commands in order. Stop and report failure if any step fails.

## Steps

1. Pull latest code:
   ```
   cd /Users/pforret/Code/AI/TropicClaw && git pull
   ```

2. Stop the running gateway (if any):
   ```
   pkill -f "bun run src/index.ts" || true
   ```

3. Wait 2 seconds, then start the gateway:
   ```
   cd /Users/pforret/Code/AI/TropicClaw && bash gateway.sh
   ```

4. Report: git pull result (lines changed), and whether the gateway started successfully.

## Safety guardrails
- Do NOT run `git push`, `git reset`, `git checkout`, or any destructive git command
- Do NOT delete or modify any files beyond what `git pull` updates
- Do NOT restart any service other than the TropicClaw gateway
- Do NOT modify system configuration or cron entries
- Stop immediately if `git pull` reports merge conflicts
