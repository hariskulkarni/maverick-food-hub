#!/usr/bin/env bash
#
# vps-deploy.sh — run THIS ON THE VPS (after: ssh deploy@148.230.66.124).
#
#   cd /opt/restaurant-manager && ./scripts/vps-deploy.sh
#   cd /opt/restaurant-manager && ./scripts/vps-deploy.sh --migrate   # if schema changed
#
# Pulls latest main, installs, builds, and restarts PM2. If the build fails the
# live process is left running, so the site stays up.
set -uo pipefail   # no -e: handle build failure explicitly

APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
WEB_DIR="$APP_DIR/apps/web"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-flavrly-prod}"
MIGRATE=false; for a in "$@"; do [ "$a" = "--migrate" ] && MIGRATE=true; done

step() { printf '\n==> %s\n' "$1"; }

# Node may not be on PATH over a bare shell — load nvm/fnm if present.
command -v npm >/dev/null 2>&1 || {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && { nvm use default >/dev/null 2>&1 || true; }
  command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)" || true
  export PATH="$PATH:/usr/local/bin:$HOME/.npm-global/bin"
}
command -v npm >/dev/null 2>&1 || { echo "ERROR: npm not found on this VPS"; exit 1; }

step "1/5 sync to origin/$BRANCH"
cd "$APP_DIR" && git fetch origin "$BRANCH" && git reset --hard "origin/$BRANCH"
echo "    HEAD: $(git log --oneline -1)"

cd "$WEB_DIR"
step "2/5 npm install"
npm install --no-audit --no-fund

if $MIGRATE; then step "3/5 prisma migrate deploy"; npx prisma migrate deploy; else step "3/5 (skip migrations)"; fi

step "4/5 build"
rm -rf .next/cache              # clear only cache → zero-downtime rebuild
ulimit -n 8192 2>/dev/null || true
if ! npm run build; then echo "(!) BUILD FAILED — leaving current build live. Fix and re-run."; exit 1; fi

step "5/5 restart PM2 ($PM2_APP)"
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP" --update-env
else
  pm2 start "$APP_DIR/ecosystem.config.js" --only "$PM2_APP" && pm2 save
fi
pm2 status "$PM2_APP" || true
echo "Done."
