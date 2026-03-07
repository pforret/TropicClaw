#!/usr/bin/env bash
# Start the TropicClaw Gateway

GATEWAY_DIR="$(dirname "$0")/gateway"
PORT=${GATEWAY_PORT:-18789}
HOST=${GATEWAY_HOST:-127.0.0.1}
URL="http://${HOST}:${PORT}/"

# Check if already running
if curl -s -o /dev/null -w "" "${URL}health" 2>/dev/null; then
  echo "Gateway already running at $URL"
  open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || echo "Open $URL in your browser"
  exit 0
fi

cd "$GATEWAY_DIR" || exit 1

echo "Starting TropicClaw Gateway..."
bun run src/index.ts 2>&1 | grep -E "^(Starting|Discovered|Gateway|HTTP|Telegram|Slack|Discord)" &
BUN_PID=$!

# Wait for gateway to be ready
for i in $(seq 1 20); do
  if curl -s -o /dev/null "${URL}health" 2>/dev/null; then
    echo "Gateway ready at $URL"
    open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || echo "Open $URL in your browser"
    wait "$BUN_PID"
    exit 0
  fi
  sleep 0.5
done

echo "Gateway failed to start within 10s" >&2
kill "$BUN_PID" 2>/dev/null
exit 1
