#!/usr/bin/env bash
# Cuts a Nexus Suite release: production build -> manifest bump -> tag -> upload.
# BRAT installs plugins from the LATEST GitHub release, and decides whether an
# update exists by comparing the "version" field in the released manifest.json.
# So the three assets below must be attached to the release itself — a plain
# git push changes nothing for anyone running BRAT.
#
#   ./release.sh 0.15.1
set -euo pipefail

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "usage: ./release.sh <version>   e.g. ./release.sh 0.15.1" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must look like x.y.z" >&2; exit 1; }

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty — commit your source changes first:" >&2
  git status --short >&2
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "tag v$VERSION already exists" >&2
  exit 1
fi

echo "==> production build"
npm run build

echo "==> manifest -> $VERSION"
tmp=$(mktemp)
jq --arg v "$VERSION" '.version = $v' manifest.json > "$tmp" && mv "$tmp" manifest.json

# versions.json maps plugin version -> minimum Obsidian version. BRAT tolerates
# its absence, but the community store requires it, so keep it honest from day one.
minapp=$(jq -r '.minAppVersion' manifest.json)
if [ -f versions.json ]; then
  tmp=$(mktemp)
  jq --arg v "$VERSION" --arg m "$minapp" '. + {($v): $m}' versions.json > "$tmp" && mv "$tmp" versions.json
else
  jq -n --arg v "$VERSION" --arg m "$minapp" '{($v): $m}' > versions.json
fi

git add manifest.json versions.json
git commit -m "release v$VERSION"
git tag "v$VERSION"
git push origin HEAD --tags

echo "==> uploading assets"
gh release create "v$VERSION" main.js manifest.json styles.css \
  --title "v$VERSION" --generate-notes

echo
echo "done. BRAT picks this up on the next Obsidian start."
echo "On the tablet: reload the plugin manually — mobile does not hot-reload."
