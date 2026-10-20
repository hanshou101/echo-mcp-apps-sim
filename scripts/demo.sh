#!/usr/bin/env bash
# Start the bundled example MCP server and the host page together.
#
#   npm run demo
#
# The example server listens on 3301, the page on 8180 (sandbox on 8181).
# Ctrl-C stops both. Point MCP_URL elsewhere to use your own server instead,
# in which case you do not need this script at all — just `npm start`.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/index.html ]; then
  echo "dist/ is missing. Run: npm run build" >&2
  exit 1
fi

fixture_port="${FIXTURE_PORT:-3301}"

FIXTURE_PORT="$fixture_port" npx tsx test/fixtures/fixture-server.ts &
fixture_pid=$!

cleanup() {
  kill "$fixture_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

MCP_URL="${MCP_URL:-http://127.0.0.1:${fixture_port}/mcp}" npx tsx server.ts
