#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Install the hourly GitHub backup launchd job on macOS.
#
# Idempotent: run it multiple times safely. To remove, run with `uninstall`:
#   ./scripts/install-auto-backup.sh uninstall
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_ROOT/scripts/com.maverick.git-backup.plist"
TARGET="$HOME/Library/LaunchAgents/com.maverick.git-backup.plist"
LABEL="com.maverick.git-backup"

# ── uninstall ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "uninstall" ]]; then
  if launchctl list | grep -q "$LABEL"; then
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$TARGET" 2>/dev/null || true
    echo "→ Unloaded $LABEL"
  fi
  rm -f "$TARGET"
  echo "✓ Uninstalled"
  exit 0
fi

# ── install ──────────────────────────────────────────────────────────────
if [[ ! -f "$TEMPLATE" ]]; then
  echo "✗ Template missing: $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

# Substitute placeholders.
sed -e "s#__REPO_ROOT__#$REPO_ROOT#g" \
    -e "s#__HOME__#$HOME#g" \
    "$TEMPLATE" > "$TARGET"

echo "→ Wrote $TARGET"

# Reload — bootout first to clear any prior install, then bootstrap.
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"

echo "✓ Loaded $LABEL"
echo ""
echo "First run is happening now (RunAtLoad). After that, hourly on :00."
echo ""
echo "Status:    launchctl list | grep maverick"
echo "Tail log:  tail -f ~/Library/Logs/maverick-git-backup.log"
echo "Stop:      ./scripts/install-auto-backup.sh uninstall"
