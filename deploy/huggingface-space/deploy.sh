#!/usr/bin/env bash
# Build the self-contained LexIntel (API + AI running in the browser) and
# publish it to the Hugging Face static Space.
#
#   deploy/huggingface-space/deploy.sh [space-repo-url]
#
# Needs git, git-lfs, Node 20+ and push access to the Space (git credentials
# for huggingface.co). Nothing runs on a server: the Space only hosts files.
set -euo pipefail

SPACE_URL=${1:-https://huggingface.co/spaces/Elisha622/lexintel-ai}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "==> building the self-contained frontend"
(cd "$ROOT/frontend" && { [ -x node_modules/.bin/vite ] || npm ci --no-audit --no-fund; } && npx tsc -b \
  && VITE_IN_BROWSER_SERVER=true npx vite build --outDir "$WORK/dist" --emptyOutDir)

echo "==> preparing the Space repository"
git clone --quiet "$SPACE_URL" "$WORK/space"
cd "$WORK/space"
git lfs install --local >/dev/null
git lfs track "*.wasm" "*.jpg" "*.jpeg" "*.png" "*.webp" >/dev/null
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .gitattributes -exec rm -rf {} +
cp -R "$WORK/dist/." .
cp "$ROOT/deploy/huggingface-space/README.md" README.md

echo "==> publishing"
git add -A
if git diff --cached --quiet; then
  echo "Nothing changed; the Space is already up to date."
  exit 0
fi
git commit --quiet -m "Deploy LexIntel $(git -C "$ROOT" rev-parse --short HEAD)"
git push --quiet origin HEAD:main
echo "Published: https://huggingface.co/spaces/${SPACE_URL#*spaces/}"
