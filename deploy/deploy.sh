#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Restaurant Manager — production deploy script
#
# Run this on the VPS, as the `deploy` user, from /opt/restaurant-manager.
# It safely pulls latest, installs deps, runs migrations, builds, and reloads PM2.
#
#   cd /opt/restaurant-manager && ./deploy/deploy.sh
#
# Behavior:
#   - Fails fast on any error (set -euo pipefail)
#   - Records the previous commit so you can roll back with ./deploy/deploy.sh rollback
#   - Uses Postgres advisory-locking via prisma so two concurrent deploys won't
#     trample each other's migrations
#   - Pings the health endpoint after reload — exits non-zero if it doesn't come
#     back green within 30 s
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/restaurant-manager}"
WEB_DIR="$APP_ROOT/apps/web"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/system/health}"
PREV_COMMIT_FILE="$APP_ROOT/.previous-commit"
LOCK_FILE="/tmp/rm-deploy.lock"

# ── locking ────────────────────────────────────────────────────────────────
if [[ -e "$LOCK_FILE" ]]; then
  echo "Another deploy is running (PID $(cat "$LOCK_FILE")). Aborting." >&2
  exit 1
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ── rollback mode ─────────────────────────────────────────────────────────
if [[ "${1:-}" == "rollback" ]]; then
  if [[ ! -f "$PREV_COMMIT_FILE" ]]; then
    echo "No previous commit recorded. Cannot roll back." >&2
    exit 1
  fi
  PREV=$(cat "$PREV_COMMIT_FILE")
  echo "Rolling back to $PREV"
  cd "$APP_ROOT"
  git checkout "$PREV"
  cd "$WEB_DIR"
  npm ci --omit=dev
  npx prisma generate
  npm run build
  pm2 reload rm-web rm-worker --update-env
  echo "Rolled back. Verify $HEALTH_URL."
  exit 0
fi

# ── normal deploy ─────────────────────────────────────────────────────────
cd "$APP_ROOT"
CURRENT_COMMIT=$(git rev-parse HEAD)
echo "Current commit: $CURRENT_COMMIT"

echo "→ Fetching latest"
git fetch --all --prune

TARGET_BRANCH="${TARGET_BRANCH:-main}"
echo "→ Checking out $TARGET_BRANCH"
git checkout "$TARGET_BRANCH"
git reset --hard "origin/$TARGET_BRANCH"

NEW_COMMIT=$(git rev-parse HEAD)
if [[ "$NEW_COMMIT" == "$CURRENT_COMMIT" ]]; then
  echo "Already up to date at $CURRENT_COMMIT. Skipping build."
else
  echo "$CURRENT_COMMIT" > "$PREV_COMMIT_FILE"
  echo "→ Deploying $CURRENT_COMMIT → $NEW_COMMIT"

  cd "$WEB_DIR"

  echo "→ Installing dependencies"
  npm ci

  echo "→ Generating Prisma client"
  npx prisma generate

  echo "→ Applying database migrations"
  npx prisma migrate deploy

  echo "→ Building production bundle"
  # KVM 2 (8 GB RAM) friendly memory cap
  NODE_OPTIONS="--max-old-space-size=2048" npm run build

  echo "→ Reloading PM2 processes"
  pm2 reload rm-web rm-worker --update-env
fi

# ── health check ──────────────────────────────────────────────────────────
echo "→ Probing health endpoint"
for i in {1..15}; do
  if curl -fsS --max-time 3 "$HEALTH_URL" | grep -q '"ok":true'; then
    echo "✓ Healthy"
    echo "Deploy complete: $NEW_COMMIT"
    exit 0
  fi
  echo "  (attempt $i — not green yet, waiting 2 s)"
  sleep 2
done

echo "✗ Health endpoint never came back green. Investigate pm2 logs rm-web." >&2
echo "   To roll back:  $0 rollback" >&2
exit 1
