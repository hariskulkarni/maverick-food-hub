#!/usr/bin/env bash
#
# mac-deploy.sh — run on your Mac. Push main, then deploy on the VPS.
#
#   1. git push origin main
#   2. ssh in, hard-sync the checkout to origin/main, run scripts/deploy-remote.sh
#
# Usage:
#   ./scripts/mac-deploy.sh             # code-only deploy
#   ./scripts/mac-deploy.sh --migrate   # also apply schema changes (passed through)
#
# Override defaults via env if anything moves:
#   REMOTE_HOST=deploy@1.2.3.4 APP_DIR=/opt/restaurant-manager BRANCH=main ./scripts/mac-deploy.sh
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-deploy@148.230.66.124}"
APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
BRANCH="${BRANCH:-main}"

git push origin "$BRANCH"

ssh "$REMOTE_HOST" "bash -lc 'cd $APP_DIR && git fetch origin $BRANCH && git reset --hard origin/$BRANCH && ./scripts/deploy-remote.sh $*'"
