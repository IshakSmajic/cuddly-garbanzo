#!/usr/bin/env bash
# Starts the dev server (port 5173, the Auth site URL) and headless Chrome,
# runs walkthrough.mjs, then stops both. Requires: Docker running and the
# local stack up (npm run db:start), Google Chrome or Chromium installed.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Chrome: $CHROME if set, otherwise the first one found (Linux, then macOS).
if [[ -z "${CHROME:-}" ]]; then
  for candidate in google-chrome-stable google-chrome chromium chromium-browser \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if command -v "$candidate" > /dev/null; then
      CHROME="$candidate"
      break
    fi
  done
fi
if [[ -z "${CHROME:-}" ]]; then
  echo "Chrome not found. Install it or set CHROME=/path/to/chrome." >&2
  exit 1
fi
PROFILE="$(mktemp -d)"

npx vite --port 5173 --strictPort > /dev/null 2>&1 &
VITE_PID=$!
"$CHROME" --headless=new --remote-debugging-port=9333 --user-data-dir="$PROFILE" \
  --no-first-run --window-size=1680,900 about:blank > /dev/null 2>&1 &
CHROME_PID=$!
# Chrome's helper processes can still be writing to the profile for a moment
# after it is killed, so retry the delete briefly.
cleanup() {
  kill $VITE_PID $CHROME_PID 2>/dev/null
  wait $CHROME_PID 2>/dev/null
  for _ in 1 2 3 4 5; do rm -rf "$PROFILE" 2>/dev/null && return; sleep 0.5; done
  echo "Note: could not delete Chrome's temporary profile $PROFILE" >&2
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -s localhost:5173 > /dev/null && curl -s localhost:9333/json/version > /dev/null; then break; fi
  sleep 0.5
done

node scripts/e2e/walkthrough.mjs
