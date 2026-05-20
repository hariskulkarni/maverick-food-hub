#!/usr/bin/env bash
#
# Runs ON YOUR MAC. One-command deploy: push to GitHub, then SSH into the VPS
# and run the remote deploy (pull → install → build → restart).
#
# Usage:
#   bash scripts/deploy.sh            # code-only deploy (no schema change)
#   bash scripts/deploy.sh --migrate  # also apply schema changes (prisma db push)
#
# Override defaults via env vars if anything moves:
#   REMOTE_HOST=deploy@1.2.3.4 APP_DIR=/opt/restaurant-manager bash scripts/deploy.sh
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-deploy@148.230.66.124}"
BRANCH="${BRANCH:-main}"

MIGRATE_FLAG=""
for arg in "$@"; do [ "$arg" = "--migrate" ] && MIGRATE_FLAG="--migrate"; done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Pushing $BRANCH to origin"
git push origin "$BRANCH"

echo "==> Running remote deploy on $REMOTE_HOST ${MIGRATE_FLAG:+(with --migrate)}"
# Pipe the remote script over SSH and run it there. Forwarding APP_DIR/BRANCH/PM2
# lets the remote honour the same overrides if you set them locally.
ssh "$REMOTE_HOST" \
  "APP_DIR='${APP_DIR:-/opt/restaurant-manager}' BRANCH='$BRANCH' PM2_APP='${PM2_APP:-rm-web}' bash -s -- $MIGRATE_FLAG" \
  < "$ROOT/scripts/deploy-remote.sh"

echo ""
echo "==> All done. Live at your site URL."
