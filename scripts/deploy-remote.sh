#!/usr/bin/env bash
#
# Runs ON THE VPS. Pulls the latest code and redeploys the web app.
# Invoked by scripts/deploy.sh over SSH, but you can also run it directly
# after SSHing in:  bash /opt/restaurant-manager/scripts/deploy-remote.sh [--migrate]
#
# Pass --migrate to apply schema changes (prisma db push) — only needed when a
# deploy includes a schema change. Most deploys don't.
#
# Always builds from apps/web (a monorepo — there is no package.json at the repo
# root), so the "no package.json" mistake can't happen.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
WEB_DIR="$APP_DIR/apps/web"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-rm-web}"

MIGRATE=false
for arg in "$@"; do [ "$arg" = "--migrate" ] && MIGRATE=true; done

echo "==> [1/5] git pull origin $BRANCH"
cd "$APP_DIR"
git pull origin "$BRANCH"

cd "$WEB_DIR"

echo "==> [2/5] npm install (idempotent; never use --omit=optional on this repo)"
npm install --no-audit --no-fund

if [ "$MIGRATE" = true ]; then
  echo "==> [3/5] prisma db push (applying schema change)"
  npx prisma db push
else
  echo "==> [3/5] skipping schema migration (pass --migrate to apply)"
fi

echo "==> [4/5] npm run build (runs prisma generate + next build)"
npm run build

echo "==> [5/5] pm2 restart $PM2_APP"
pm2 restart "$PM2_APP"

echo ""
echo "==> Deploy complete."
pm2 status "$PM2_APP" || true
