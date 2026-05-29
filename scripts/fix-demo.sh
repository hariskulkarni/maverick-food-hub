#!/usr/bin/env bash
#
# Deploy the DEMO process on the VPS. The demo and prod runtimes share the
# SAME source tree + the SAME `.next` build directory — they differ only in
# their .env file (and therefore their DB, port, integrations, DEMO_MODE).
# Because of that, fix-prod.sh has ALREADY built the code for both — this
# script only needs to migrate the demo DB and reload the demo pm2 process.
#
# Invoke from your Mac (pipes the script over SSH, like fix-prod.sh):
#   ssh deploy@148.230.66.124 'bash -s' < scripts/fix-demo.sh
#
set -uo pipefail

APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
WEB_DIR="$APP_DIR/apps/web"
PM2_APP="${PM2_APP:-flavrly-demo}"
ENV_FILE="${ENV_FILE:-.env.demo}"

line() { printf '\n========== %s ==========\n' "$1"; }

# ── Make node/npm/pm2 available over non-interactive SSH ──
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
  command -v npm >/dev/null 2>&1
}

line "0. locate node/npm"
if ! load_node; then echo "ERROR: npm not found on VPS"; exit 1; fi
echo "node $(node -v) · npm $(npm -v)"

line "1. ensure demo env file exists"
if [ ! -f "$WEB_DIR/$ENV_FILE" ]; then
  echo "ERROR: $WEB_DIR/$ENV_FILE not found."
  echo "       Copy .env.demo.example → .env.demo on the VPS and fill in the values."
  exit 1
fi
echo "OK — $ENV_FILE present"

cd "$WEB_DIR"

line "2. preflight: required demo env"
require_env() {
  local k="$1"
  local v
  v="$(grep -E "^$k=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2-)"
  if [ -z "$v" ]; then
    echo "  (!) $k is missing/empty in $ENV_FILE — REQUIRED."
    return 1
  else
    echo "  OK — $k is set"
    return 0
  fi
}
ok=1
require_env DEMO_MODE        || ok=0
require_env DATABASE_URL     || ok=0
require_env NEXT_PUBLIC_SITE_URL || ok=0
require_env NEXTAUTH_SECRET  || ok=0
if [ "$ok" != "1" ]; then
  echo ""
  echo "Preflight failed — fix the env above and re-run. Demo NOT touched."
  exit 1
fi

line "3. sync demo DB schema"
# Re-use the same prisma schema; just point at the demo DB via .env.demo.
#
# Prisma reads connection info from `process.env`, and shell env vars take
# precedence over any .env file it might auto-load. So load .env.demo into
# the current shell first (set -a auto-exports every assignment), strip
# comments + blanks, then invoke the local prisma CLI.
load_dotenv() {
  local f="$1"
  # Filter out comment + blank lines so `.` (source) doesn't choke on them.
  set -a
  # shellcheck disable=SC1090
  . <(grep -E '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' "$f")
  set +a
}
load_dotenv "$WEB_DIR/$ENV_FILE"

# Verify the var prisma actually needs is now in the env.
if [ -z "${DATABASE_URL:-}" ]; then
  echo "(!) DATABASE_URL didn't load from $ENV_FILE — check the file's syntax (KEY=value, no spaces around =)."
  exit 1
fi

npx --no-install prisma db push --schema=prisma/schema.prisma 2>&1 || {
  echo "(!) prisma db push failed — check DATABASE_URL in $ENV_FILE."
  exit 1
}

line "4. reload pm2 demo process"
# The build artefacts are already in .next (fix-prod.sh did the build). All we
# need is to reload the demo process so it picks up new env / restart cleanly.
pm2 reload "$PM2_APP" --update-env || pm2 start /opt/restaurant-manager/ecosystem.config.js --only "$PM2_APP"
pm2 status "$PM2_APP" || true

line "5. flush old demo logs"
LOG_DIR="${LOG_DIR:-/var/log/restaurant-manager}"
pm2 flush "$PM2_APP" >/dev/null 2>&1 && echo "  pm2 flush ✓" || echo "  (pm2 flush skipped)"
if [ -d "$LOG_DIR" ]; then
  for f in "$LOG_DIR"/demo-*.log; do
    [ -e "$f" ] || continue
    truncate -s 0 "$f" 2>/dev/null && echo "  truncated $f ✓" || true
  done
fi
sleep 3

line "6. recent demo error log"
pm2 logs "$PM2_APP" --err --lines 30 --nostream || true

line "DONE"
echo "Demo redeployed → https://demo.flavrly.in"
