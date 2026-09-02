#!/usr/bin/env bash
# The token block is declared twice on purpose — once in the plugin
# (src/styles/00-tokens.css, on :root and body) and once in the theme
# (themes/Nexus/theme.css, on .theme-dark/.theme-light). The theme wins where it
# is active; the plugin keeps working under any other theme. Two copies drift,
# so this compares them and fails if they ever disagree.
#
# It is a file comparison, not a DOM behaviour, so it runs here rather than as
# a browser page.
set -euo pipefail
cd "$(dirname "$0")/.."

PLUGIN=src/styles/00-tokens.css
THEME=../../themes/Nexus/theme.css

block() { sed -n '/>>> NX TOKENS >>>/,/<<< NX TOKENS <<</p' "$1"; }

if [ ! -f "$THEME" ]; then
  echo "SKIP  tokens · the Nexus theme is not in this checkout"
  exit 0
fi

lines=$(block "$PLUGIN" | wc -l)
if [ "$lines" -lt 10 ]; then
  echo "FAIL  tokens · no NX TOKENS block found in $PLUGIN"
  exit 1
fi

if diff <(block "$PLUGIN") <(block "$THEME") > /tmp/nx-tokens.diff 2>&1; then
  echo "PASS  tokens · plugin and theme declare the same $lines lines"
else
  echo "FAIL  tokens · the two blocks have drifted:"
  cat /tmp/nx-tokens.diff
  exit 1
fi

# A literal radius outside the token block is a defect (see docs/style-guide.md
# in the theme). The only literals allowed are 0 and a line that says why it is
# one — a picture of a corner rather than a corner, marked `nx-literal-ok`.
stray=$(grep -rnE 'border-radius:[^;]*[0-9]+(px|%|em)' src/styles/ 2>/dev/null \
        | grep -v '00-tokens.css' | grep -v 'nx-literal-ok' || true)
if [ -n "$stray" ]; then
  echo "FAIL  tokens · literal border-radius outside the token block:"
  echo "$stray" | sed 's/^/        /'
  exit 1
fi
echo "PASS  tokens · every literal radius is either 0 or marked nx-literal-ok"
