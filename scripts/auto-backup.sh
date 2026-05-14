#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Hourly safety-net backup → GitHub
#
# Non-destructive snapshot of the working tree + index + current commit, pushed
# to the `backup/auto` branch on origin. Does not touch your index, working
# tree, or whatever branch you happen to be on.
#
# How it works:
#   1. `git stash create` builds a commit object capturing tracked+staged state
#      (and optionally untracked) WITHOUT modifying the workspace
#   2. We update refs/heads/backup/auto to point at that commit
#   3. Force-push backup/auto to origin (it's a single rolling "last good" snap)
#
# Run by launchd every hour (see deploy/com.maverick.git-backup.plist).
# Manually: ./scripts/auto-backup.sh
#
# Log: ~/Library/Logs/maverick-git-backup.log
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${LOG_FILE:-$HOME/Library/Logs/maverick-git-backup.log}"
BACKUP_BRANCH="backup/auto"
REMOTE="${REMOTE:-origin}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -Iseconds)] $*" >> "$LOG_FILE"
}

cd "$REPO_ROOT"

# ── pre-flight ───────────────────────────────────────────────────────────
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  log "ERROR: not a git repository at $REPO_ROOT"
  exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
  log "ERROR: remote '$REMOTE' is not configured. Run scripts/init-git.sh first."
  exit 1
fi

# ── snapshot ─────────────────────────────────────────────────────────────
# --include-untracked picks up new files; --keep-index leaves staging alone.
# stash create returns either the commit SHA or empty (nothing to stash).
SNAPSHOT_SHA="$(git stash create --include-untracked "auto-backup $(date -Iseconds)" 2>/dev/null || true)"

if [[ -z "$SNAPSHOT_SHA" ]]; then
  # Working tree is clean — back up HEAD itself so backup/auto stays current.
  SNAPSHOT_SHA="$(git rev-parse HEAD)"
  log "clean tree — pointing $BACKUP_BRANCH at HEAD ($SNAPSHOT_SHA)"
else
  log "dirty tree — captured snapshot $SNAPSHOT_SHA"
fi

# Move the local backup branch to the snapshot commit.
git update-ref "refs/heads/$BACKUP_BRANCH" "$SNAPSHOT_SHA"

# ── push ─────────────────────────────────────────────────────────────────
# Force-push — backup/auto is a single rolling "latest snapshot" branch.
# GitHub keeps the prior tip in its reflog for 90 days so nothing is truly lost.
if git push --force-with-lease "$REMOTE" "$BACKUP_BRANCH:$BACKUP_BRANCH" 2>>"$LOG_FILE"; then
  log "pushed $BACKUP_BRANCH → $REMOTE ($SNAPSHOT_SHA)"
else
  log "ERROR: push failed (check auth + connectivity)"
  exit 1
fi

# Optional: write a marker file the UI can show
echo "$SNAPSHOT_SHA $(date -Iseconds)" > "$REPO_ROOT/.git-auto-backup.log"
