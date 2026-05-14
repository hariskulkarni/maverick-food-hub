#!/usr/bin/env bash
# Installs msitarzewski/agency-agents into ~/.claude/agents (global, all divisions).
# Safe to re-run; uses a fresh tmp clone each time.

set -euo pipefail

REPO_URL="https://github.com/msitarzewski/agency-agents.git"
TMP_DIR="$(mktemp -d -t agency-agents.XXXXXX)"
TARGET_DIR="$HOME/.claude/agents"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "==> Cloning $REPO_URL into $TMP_DIR"
git clone --depth=1 "$REPO_URL" "$TMP_DIR"

mkdir -p "$TARGET_DIR"

cd "$TMP_DIR"

if [[ -x "./scripts/install.sh" ]]; then
  echo "==> Running official installer (--tool claude-code)"
  ./scripts/install.sh --tool claude-code
else
  echo "==> install.sh not found or not executable; falling back to direct copy"
  # Copy every top-level division's *.md into ~/.claude/agents
  shopt -s nullglob
  for dir in academic design engineering finance game-development marketing \
             paid-media product project-management sales spatial-computing \
             specialized support testing; do
    if [[ -d "$dir" ]]; then
      cp -v "$dir"/*.md "$TARGET_DIR"/ 2>/dev/null || true
    fi
  done
fi

echo
echo "==> Installed agents now in $TARGET_DIR:"
ls -1 "$TARGET_DIR" | wc -l | xargs -I{} echo "{} files"
echo "==> Done."
