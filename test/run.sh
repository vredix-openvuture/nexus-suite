#!/usr/bin/env bash
# Toolbar tests. There is no Obsidian here, so the plugin is bundled against a
# stub (test/obsidian-stub.js) and driven in headless Chromium against a REAL
# DOM — the layout logic is what is under test, not the stroke engine.
#
#   ./test/run.sh          run the assertions
#   ./test/run.sh visual   also write test/visual.png to look at
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=8731

npx esbuild test/entry.js --bundle --format=iife --platform=browser --target=es2018 \
  --alias:obsidian=./test/obsidian-stub.js \
  --external:electron --external:fs --external:path --external:os --external:crypto \
  --external:child_process --external:util --external:events --external:stream \
  --external:http --external:https --external:url --external:zlib --external:net \
  --external:tls --external:assert --external:buffer \
  --outfile=test/bundle.js >/dev/null

ln -sfn .. test/plugin
python3 -m http.server "$PORT" --directory test >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; rm -f test/plugin' EXIT
sleep 1

fail=0

# The token blocks are two files, not a DOM — compared here rather than in a page.
echo "── tokens ──"
"$(dirname "$0")/tokens.sh" || fail=1

for page in test measure select canvas notesketch objects gestures export search kanban tasks planner sync quicknote startup settings capture inkvault galaxy; do
  result=$(chromium --headless --disable-gpu --no-sandbox --virtual-time-budget=6000 \
    --dump-dom "http://localhost:$PORT/$page.html" 2>/dev/null |
    python3 -c "
import sys, re, html
d = sys.stdin.read()
m = re.search(r'<pre id=\"out\">(.*?)</pre>', d, re.S)
print(html.unescape(m.group(1)).strip() if m else 'NO OUTPUT - the page did not run')
")
  echo "── $page ──"
  echo "$result"
  echo "$result" | grep -q "ALL GREEN" || fail=1
done

if [ "${1:-}" = "visual" ]; then
  chromium --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --window-size=1000,2100 --virtual-time-budget=5000 \
    --screenshot=test/visual.png "http://localhost:$PORT/visual.html" 2>/dev/null
  echo "wrote test/visual.png"
fi

exit $fail
