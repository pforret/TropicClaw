---
cron: "0 3 * * *"
enabled: true
timeout: 120
singleton: true
description: "Daily git pull and gateway restart at 04:00 CET (03:00 UTC)"
---

# Daily pull & gateway restart

1. Run `git pull origin main` to get the latest changes
2. Restart the gateway process:
   - Find any running gateway process (`pgrep -f "bun run src/index.ts"` or similar)
   - Kill it gracefully
   - Start it again with `cd gateway && bun run start &`
3. Verify the gateway is responding (wait a few seconds, then check the process is running)
4. Report what changed (new commits pulled, restart status)

## Safety guardrails
- Do NOT force-push or modify git history
- Do NOT run `git reset --hard` or discard uncommitted changes
- Do NOT delete any files
- Do NOT modify environment variables or .env files
- Do NOT change gateway configuration
- If `git pull` has merge conflicts, abort and report — do NOT force-resolve
- If gateway fails to start after restart, report the error — do NOT retry more than once
