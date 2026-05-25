#!/usr/bin/env bash
#
# Runs ON THE VPS. Full production recovery sweep:
#   1. Pull latest code (hard sync to origin/main)
#   2. npm install
#   3. prisma db push   — sync the production schema (adds any missing columns,
#                          e.g. Branch.packagingFee / Order.packagingFee)
#   4. Verify the packagingFee column actually exists
#   5. rm -rf .next     — clear any stale build cache
#   6. npm run build    — recompile + regenerate the Prisma client
#   7. pm2 restart      — swap the live process to the new build
#   8. Tail the error log so we can confirm there are no more exceptions
#
# Invoke from your Mac (pipes this script over SSH, like deploy.sh):
#   ssh deploy@148.230.66.124 'bash -s' < scripts/fix-prod.sh
#
# Override the app dir / branch / pm2 app via env if they differ:
#   ssh deploy@host "APP_DIR=/opt/restaurant-manager bash -s" < scripts/fix-prod.sh
set -uo pipefail   # NOTE: no -e — we want every diagnostic step to run even if one warns.

APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
WEB_DIR="$APP_DIR/apps/web"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-rm-web}"

line() { printf '\n========== %s ==========\n' "$1"; }

# ── Make node/npm/pm2 available over non-interactive SSH (same as deploy-remote.sh) ──
load_node() {
  command -v npm >/dev/null 2>&1 && return 0
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || true
  fi
  command -v npm >/dev/null 2>&1 && return 0
  if [ -d "$NVM_DIR/versions/node" ]; then
    latest="$(ls -1 "$NVM_DIR/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "${latest:-}" ] && export PATH="$NVM_DIR/versions/node/$latest/bin:$PATH"
  fi
  command -v npm >/dev/null 2>&1 && return 0
  command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)" || true
  export PATH="$PATH:/usr/local/bin:/usr/bin:$HOME/.local/bin:$HOME/.npm-global/bin"
  command -v npm >/dev/null 2>&1
}

line "0. locate node/npm"
if ! load_node; then echo "ERROR: npm not found on VPS"; exit 1; fi
echo "node $(node -v) · npm $(npm -v) · $(command -v npm)"

line "1. git: sync to origin/$BRANCH"
cd "$APP_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "HEAD is now: $(git log --oneline -1)"

cd "$WEB_DIR"

line "1.5 preflight: required production env"
# Fail FAST (before building) on env that would otherwise hard-crash the app at
# boot, with an actionable message instead of a cryptic runtime error.
PREFLIGHT_OK=1
envval() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }

ENC_KEY="$(envval INTEGRATION_ENCRYPTION_KEY)"
if [ -z "$ENC_KEY" ]; then
  echo "  (!) INTEGRATION_ENCRYPTION_KEY is missing/empty in .env — REQUIRED in production."
  echo "      Generate + add it with:"
  echo "        echo \"INTEGRATION_ENCRYPTION_KEY=\$(openssl rand -base64 32)\" >> $WEB_DIR/.env"
  PREFLIGHT_OK=0
else
  echo "  OK — INTEGRATION_ENCRYPTION_KEY is set"
fi

SMS_PROVIDER="$(envval NOTIFIER_SMS)"
OTP_DEMO="$(envval OTP_DEMO_MODE)"
OTP_DEBUG="$(envval OTP_DEBUG_LOG)"
if [ -n "$SMS_PROVIDER" ] && [ "$SMS_PROVIDER" != "mock" ] && { [ "$OTP_DEMO" = "true" ] || [ "$OTP_DEBUG" = "true" ]; }; then
  echo "  (!) OTP demo mode is ON while a REAL SMS provider ($SMS_PROVIDER) is configured."
  echo "      This leaks real users' OTPs and the app refuses to boot. Set OTP_DEMO_MODE=false"
  echo "      and remove OTP_DEBUG_LOG in $WEB_DIR/.env."
  PREFLIGHT_OK=0
else
  echo "  OK — OTP mode is consistent with the SMS provider"
fi

if [ "$PREFLIGHT_OK" != "1" ]; then
  echo ""
  echo "Preflight failed — fix the env above and re-run. Not building (the current"
  echo "running build is left untouched so the site stays up)."
  exit 1
fi

line "2. schema.prisma: does it define packagingFee?"
grep -n "packagingFee" prisma/schema.prisma || echo "  (!) packagingFee NOT in schema — code/schema mismatch"

line "3. which database is configured (host/db only, no secrets)"
node -e 'try{const u=new URL(process.env.DATABASE_URL);console.log("host:",u.host,"db:",u.pathname)}catch(e){console.log("DATABASE_URL not parseable")}' 2>/dev/null || echo "  (could not read DATABASE_URL)"

line "4. npm install"
npm install --no-audit --no-fund

line "5. prisma db push (sync schema → add missing columns)"
npx prisma db push

line "6. verify packagingFee column exists on the live DB"
if echo 'SELECT "packagingFee" FROM "Branch" LIMIT 1;' | npx prisma db execute --stdin >/dev/null 2>&1; then
  echo "  OK — Branch.packagingFee exists"
else
  echo "  (!) Branch.packagingFee still missing — db push did not apply it"
fi

line "7. clear stale build cache"
# Clear ONLY the webpack build cache — NOT the whole .next. The live pm2
# process keeps serving the current build during the rebuild below, and it
# reads .next/required-server-files.json on every request. Deleting the whole
# .next here pulls that file out from under the running process and throws
# ENOENT on every request for the ~30-40s the build takes. `next build`
# regenerates the production output in place, so clearing just the cache gives
# a clean build with zero downtime window.
rm -rf .next/cache

line "8. build (raise fd limit so a large route tree can't hit EMFILE)"
ulimit -n 8192 || true
npm run build
BUILD_RC=$?
if [ "$BUILD_RC" != "0" ]; then
  echo ""
  echo "(!) BUILD FAILED (exit $BUILD_RC). NOT restarting pm2 — the previously"
  echo "    running build is left intact so the site stays up. Fix the build"
  echo "    error above, then re-run this script."
  echo "    (If .next was cleared and the site is already down, the last good"
  echo "     build must be rebuilt — fix the error and re-run.)"
  exit 1
fi

line "9. restart pm2"
pm2 restart "$PM2_APP" --update-env
pm2 status "$PM2_APP" || true

line "10. recent error log (should be quiet if fixed)"
pm2 logs "$PM2_APP" --err --lines 40 --nostream || true

line "DONE"
echo "Hard-refresh the site (Cmd+Shift+R). If errors persist, copy the section-10 log here."
