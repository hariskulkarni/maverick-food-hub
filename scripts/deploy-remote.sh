#!/usr/bin/env bash
#
# Runs ON THE VPS. Pulls the latest code and redeploys the web app.
# Invoked by scripts/deploy.sh over SSH, but you can also run it directly
# after SSHing in:  bash /opt/restaurant-manager/scripts/deploy-remote.sh [--migrate]
#
# Pass --migrate to apply schema changes (prisma migrate deploy) — only needed when a
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

# ── Make node/npm/pm2 available ──────────────────────────────────────────────
# Over a non-interactive SSH command (`ssh host "..."`), the shell does NOT load
# ~/.bashrc, so an nvm/fnm-managed Node isn't on PATH and `npm` is "command not
# found" — which silently skips the build. Resolve Node explicitly here so the
# deploy works the same interactively or piped over SSH.
load_node() {
  command -v npm >/dev/null 2>&1 && return 0
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # 1) Source nvm + select a version.
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || true
  fi
  command -v npm >/dev/null 2>&1 && return 0
  # 2) nvm with no default alias: add the newest installed version's bin to PATH.
  if [ -d "$NVM_DIR/versions/node" ]; then
    latest="$(ls -1 "$NVM_DIR/versions/node" 2>/dev/null | sort -V | tail -1)"
    [ -n "${latest:-}" ] && export PATH="$NVM_DIR/versions/node/$latest/bin:$PATH"
  fi
  command -v npm >/dev/null 2>&1 && return 0
  # 3) fnm.
  command -v fnm >/dev/null 2>&1 && eval "$(fnm env 2>/dev/null)" || true
  # 4) Common install locations.
  export PATH="$PATH:/usr/local/bin:/usr/bin:$HOME/.local/bin:$HOME/.npm-global/bin"
  command -v npm >/dev/null 2>&1
}

echo "==> [0/5] locating node/npm"
if ! load_node; then
  echo "ERROR: could not find npm on the VPS. Find it with:  ssh $USER@<host> 'bash -ic \"command -v npm node pm2\"'"
  echo "Then re-run with that bin dir prepended, e.g.:  PATH=/path/to/node/bin:\$PATH bash scripts/deploy-remote.sh"
  exit 1
fi
echo "    node $(node -v 2>/dev/null) · npm $(npm -v 2>/dev/null) · $(command -v npm)"

echo "==> [1/5] git pull origin $BRANCH"
cd "$APP_DIR"
git pull origin "$BRANCH"

cd "$WEB_DIR"

echo "==> [2/5] npm install (idempotent; never use --omit=optional on this repo)"
npm install --no-audit --no-fund

if [ "$MIGRATE" = true ]; then
  # Versioned migrations only: `db push` skips the raw-SQL money invariants
  # (partial unique indexes, CHECKs, append-only trigger) in prisma/migrations.
  # First run on a db-pushed DB: see docs/flavrly-pg/DATABASE_MIGRATIONS.md.
  echo "==> [3/5] prisma migrate deploy (applying schema change)"
  npx prisma migrate deploy
else
  # C14.2: don't silently deploy new code against the old schema. Detect whether
  # the committed Prisma schema would change the live DB and, if so, abort loudly
  # instead of building. Re-run with --migrate (or the manual deploy dispatch
  # with migrate=true) to apply it.
  echo "==> [3/5] checking for pending schema changes"
  if npx prisma migrate diff \
        --from-schema-datasource prisma/schema.prisma \
        --to-schema-datamodel prisma/schema.prisma \
        --exit-code >/dev/null 2>&1; then
    echo "    no schema drift — skipping migration"
  else
    diff_status=$?
    if [ "$diff_status" = "2" ]; then
      echo "ERROR: the committed Prisma schema differs from the live database, but --migrate was not passed."
      echo "       Deploying now would run new code against the old schema. Re-deploy with --migrate"
      echo "       (or the manual Deploy dispatch with migrate=true) to apply the schema change."
      exit 1
    fi
    # Any other non-zero (e.g. diff tool error) is not a confirmed drift; warn and continue.
    echo "    WARNING: could not determine schema drift (prisma migrate diff exit $diff_status); continuing without migration"
  fi
fi

echo "==> [4/5] npm run build (runs prisma generate + next build)"
# C14.3: do NOT `rm -rf .next` before building. A failing build then leaves
# nothing for `next start` to serve, taking prod fully down — and the retry
# wiped it three times over. Clear only `.next/cache` (the safe reset that
# scripts/fix-prod.sh already uses); a successful `next build` overwrites the
# build output in place, so the previous bootable build survives a failed build.
#
# Next 15 intermittently fails the FINAL 404/500 page-copy step with a transient
# rename ENOENT. It is not caused by our code — an identical rebuild succeeds —
# so retry the build once on failure, clearing only the cache between attempts.
build_once() { rm -rf .next/cache; npm run build; }
if ! build_once; then
  echo "    build failed — retrying once after clearing .next/cache (transient Next.js page-copy race)"
  sleep 2
  build_once
fi

echo "==> [5/5] pm2 restart $PM2_APP"
pm2 restart "$PM2_APP"

echo ""
echo "==> Deploy complete."
pm2 status "$PM2_APP" || true
