#!/usr/bin/env bash
# Starts the dev server (port 5173, the Auth site URL) and headless Chrome,
# runs walkthrough.mjs, then stops both. Requires: Docker running and the
# local stack up (npm run db:start), Google Chrome installed.
set -euo pipefail
cd "$(dirname "$0")/../.."

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="$(mktemp -d)"

npx vite --port 5173 --strictPort > /dev/null 2>&1 &
VITE_PID=$!
"$CHROME" --headless=new --remote-debugging-port=9333 --user-data-dir="$PROFILE" \
  --no-first-run --window-size=1680,900 about:blank > /dev/null 2>&1 &
CHROME_PID=$!
trap 'kill $VITE_PID $CHROME_PID 2>/dev/null; rm -rf "$PROFILE"' EXIT

for _ in $(seq 1 60); do
  if curl -s localhost:5173 > /dev/null && curl -s localhost:9333/json/version > /dev/null; then break; fi
  sleep 0.5
done

node scripts/e2e/walkthrough.mjs
