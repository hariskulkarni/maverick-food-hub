#!/usr/bin/env bash
# Integrated demo — bring the whole local stack up with one command (LOCAL ONLY, fake data).
#
#   scripts/integrated-demo/up.sh            # stack only
#   scripts/integrated-demo/up.sh --record   # stack, then run-demo.sh (screenshots + video)
#   scripts/integrated-demo/down.sh          # stop everything, drop data, remove scratch worktrees
#
# What it does (idempotent where possible):
#   1. scratch worktrees: Novaryq at $NQ_BRANCH (+ $NQ_IN_BRANCH merged when it exists) and Flavrly
#      at $FL_BRANCH — never the NQ/FL agents' worktrees or the owner's checkouts; node_modules are
#      APFS clones (cp -c) of $NQ_REPO / $FL_REPO.
#   2. applies patches/novaryq-demo-loopback-webhooks.patch to the scratch Novaryq worktree only:
#      webhooks to 127.0.0.1 are allowed when NOVARYQ_DEMO_ALLOW_LOOPBACK_WEBHOOKS=true AND
#      NODE_ENV != production. Production egress policy is unchanged; the patch is never committed.
#   3. private Postgres 16 cluster on :$PG_PORT + Redis on :$REDIS_PORT under $STATE.
#   4. Novaryq: migrate deploy, rls.sql + rls-roles.sql (as the release gate does), stock seed, then
#      seed-novaryq.ts (IN tenant "Flavrly Test Kitchen": INR, IST, fake test GSTIN, HSN items).
#   5. Flavrly: migrate deploy, stock seed, seed-flavrly.ts (restaurant, branch, test customer + rider).
#   6. starts Novaryq API (:$NQ_API_PORT), Novaryq web (vite :$NQ_WEB_PORT), Flavrly (next dev :$FL_PORT)
#      and a 5-second "cron" loop for the Flavrly novaryq-worker job.
#   7. link-novaryq.mjs: the owner's Novaryq console steps (API key + webhook subscription → Flavrly).
#   Credentials generated at run time land in $STATE/demo.env (local, throwaway).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/demo.conf"
mkdir -p "$STATE"
log() { printf '\n== %s\n' "$*"; }

need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
for c in git node npx psql initdb pg_ctl redis-server curl; do need "$c"; done
avail_gb=$(df -g "$HOME" | awk 'NR==2{print $4}')
[ "${avail_gb:-0}" -ge 3 ] || { echo "refusing: only ${avail_gb} GB free (need 3)" >&2; exit 1; }

log "1. scratch worktrees"
git -C "$NQ_REPO" fetch -q origin
git -C "$FL_REPO" fetch -q origin
if [ ! -d "$NQ_WT" ]; then
  git -C "$NQ_REPO" worktree add -q --detach "$NQ_WT" "$NQ_BRANCH"
  if git -C "$NQ_REPO" rev-parse -q --verify "$NQ_IN_BRANCH" >/dev/null; then
    git -C "$NQ_WT" -c user.name=demo -c user.email=demo@localhost merge -q --no-edit "$NQ_IN_BRANCH"
  fi
  cp -c -R "$NQ_REPO/node_modules" "$NQ_WT/node_modules"
  cp -c -R "$NQ_REPO/apps/api/node_modules" "$NQ_WT/apps/api/node_modules"
  cp -c -R "$NQ_REPO/apps/web/node_modules" "$NQ_WT/apps/web/node_modules"
  git -C "$NQ_WT" apply "$HERE/patches/novaryq-demo-loopback-webhooks.patch"
fi
if [ ! -d "$FL_WT" ]; then
  git -C "$FL_REPO" worktree add -q --detach "$FL_WT" "$FL_BRANCH"
  cp -c -R "$FL_REPO/apps/web/node_modules" "$FL_WT/apps/web/node_modules"
fi
mkdir -p "$NQ_WT/apps/api/qa-demo" "$FL_WT/apps/web/qa-demo"
cp "$HERE/seed-novaryq.ts" "$NQ_WT/apps/api/qa-demo/"
cp "$HERE/seed-flavrly.ts" "$FL_WT/apps/web/qa-demo/"

log "2. Postgres :$PG_PORT + Redis :$REDIS_PORT"
if [ ! -d "$STATE/pg" ]; then initdb -D "$STATE/pg" -U postgres --auth-local=trust --auth-host=trust >/dev/null; fi
pg_ctl -D "$STATE/pg" status >/dev/null 2>&1 || pg_ctl -D "$STATE/pg" -o "-p $PG_PORT -c listen_addresses=127.0.0.1" -l "$STATE/pg.log" -w start >/dev/null
redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 || { mkdir -p "$STATE/redis"; redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --daemonize yes --dir "$STATE/redis" --save "" --appendonly no; }
PSQL=(psql -h 127.0.0.1 -p "$PG_PORT" -U postgres -v ON_ERROR_STOP=1 -q)
for r in novaryq novaryq_app novaryq_jobs novaryq_resolver novaryq_marketing_ops novaryq_growth_evidence \
         novaryq_growth_retention_executor novaryq_redemption_owner novaryq_retention_owner novaryq_marketing_append_owner; do
  "${PSQL[@]}" -d postgres -c "DO \$\$ BEGIN CREATE ROLE $r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"
done
FRESH=0
if ! "${PSQL[@]}" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='ci_demo_nq'" | grep -q 1; then
  "${PSQL[@]}" -d postgres -c "CREATE DATABASE ci_demo_nq" -c "CREATE DATABASE ci_demo_fl" \
    -c "ALTER DATABASE ci_demo_nq SET timezone = 'UTC'"
  FRESH=1
fi

log "3. Novaryq schema + seeds"
( cd "$NQ_WT" && npm --workspace @novaryq/shared run build >/dev/null )
( cd "$NQ_WT/apps/api" && npx prisma generate >/dev/null )
if [ "$FRESH" = 1 ]; then
  ( cd "$NQ_WT/apps/api"
    DATABASE_URL="$NQ_DB_URL" npx prisma migrate deploy >"$STATE/nq-migrate.log" 2>&1
    psql "$NQ_DB_URL" -v ON_ERROR_STOP=1 -q -f prisma/rls.sql >/dev/null
    psql "$NQ_DB_URL" -v ON_ERROR_STOP=1 -q -v app_pw=demo-disposable -v jobs_pw=demo-disposable -v resolver_pw=demo-disposable \
      -v marketing_ops_pw=demo-disposable -v growth_evidence_pw=demo-disposable -v growth_retention_pw=demo-disposable \
      -v growth_freeze_pw=demo-disposable -f prisma/rls-roles.sql >/dev/null
    mkdir -p "$STATE/media"
    DATABASE_URL="$NQ_DB_URL" REDIS_URL="redis://127.0.0.1:$REDIS_PORT" MEDIA_DIR="$STATE/media" NODE_ENV=development \
      npx ts-node --transpile-only prisma/seed.ts >"$STATE/nq-seed.log" 2>&1 )
fi
( cd "$NQ_WT/apps/api" && DATABASE_URL="$NQ_DB_URL" npx ts-node --transpile-only qa-demo/seed-novaryq.ts ) >"$STATE/nq.env"

log "4. Flavrly schema + seeds"
FL_ENV="$FL_WT/apps/web/.env.local"
if [ ! -f "$FL_ENV" ]; then
  cat >"$FL_ENV" <<EOF
# LOCAL INTEGRATED DEMO ONLY (scripts/integrated-demo) — generated, throwaway values. Never deploy.
DATABASE_URL=$FL_DB_URL?schema=public
NEXTAUTH_SECRET=$(openssl rand -hex 24)
NEXTAUTH_URL=$FL_URL
AUTH_TRUST_HOST=true
INTEGRATION_ENCRYPTION_KEY=$(openssl rand -base64 32)
PAYMENT_PROVIDER=mock
NOTIFIER_SMS=mock
NOTIFIER_WHATSAPP=mock
NOTIFIER_EMAIL=mock
OTP_DEMO_MODE=true
STORAGE_DRIVER=local
NEXT_PUBLIC_CURRENCY=INR
INTERNAL_CRON_SECRET=$(openssl rand -hex 16)
NOVARYQ_INTEGRATION_ENABLED=true
NOVARYQ_ALLOW_INSECURE_BASE_URL=true
NOVARYQ_WEBHOOK_BASE_URL=http://127.0.0.1:$FL_PORT
EOF
fi
( cd "$FL_WT/apps/web"
  set -a; . ./.env.local; set +a
  npx prisma generate >/dev/null
  if [ "$FRESH" = 1 ]; then
    npx prisma migrate deploy >"$STATE/fl-migrate.log" 2>&1
    npx tsx prisma/seed.ts >"$STATE/fl-seed.log" 2>&1
  fi
  npx tsx qa-demo/seed-flavrly.ts 2>>"$STATE/fl-seed.log" | grep -v '^{"level"' ) >"$STATE/fl.env"

log "5. servers"
start() { # name, dir, command...
  local name=$1 dir=$2; shift 2
  if [ -f "$STATE/$name.pid" ] && kill -0 "$(cat "$STATE/$name.pid")" 2>/dev/null; then return; fi
  ( cd "$dir" && nohup nice -n 10 "$@" >"$STATE/$name.log" 2>&1 </dev/null & echo $! >"$STATE/$name.pid" )
}
start nq-api "$NQ_WT/apps/api" env NODE_ENV=development PORT="$NQ_API_PORT" \
  DATABASE_URL="$NQ_DB_URL" DATABASE_URL_RESOLVER="$NQ_DB_URL" DATABASE_URL_JOBS="$NQ_DB_URL" DATABASE_URL_CONTROL="$NQ_DB_URL" \
  REDIS_URL="redis://127.0.0.1:$REDIS_PORT" JWT_SECRET="demo-local-$(cat "$STATE/pg/PG_VERSION")-jwt-secret-not-for-production" \
  CSRF_SIGNING_SECRET="demo-local-csrf-secret-not-for-production-0000" MEDIA_DIR="$STATE/media" \
  CORS_ALLOWED_ORIGINS="http://localhost:$NQ_WEB_PORT" MFA_POLICY=optional NOVARYQ_DEMO_ALLOW_LOOPBACK_WEBHOOKS=true \
  npx ts-node --transpile-only src/main.ts
start nq-web "$NQ_WT/apps/web" env VITE_API_URL="http://localhost:$NQ_API_PORT" VITE_PWA_SW=false npx vite --port "$NQ_WEB_PORT" --strictPort
start fl-web "$FL_WT/apps/web" npx next dev -p "$FL_PORT"
until curl -s -o /dev/null "http://127.0.0.1:$NQ_API_PORT/api/v1/me"; do sleep 3; done
until curl -s -o /dev/null --max-time 300 "$FL_URL/"; do sleep 3; done
CRON_SECRET=$(grep '^INTERNAL_CRON_SECRET=' "$FL_ENV" | cut -d= -f2)
# Stand-in for deploy/flavrly-jobs.cron (every minute in production) — every 5 s so the demo is quick.
start fl-cron "$STATE" bash -c "while true; do curl -s -o /dev/null -X POST -H 'x-internal-secret: $CRON_SECRET' $FL_URL/api/platform/jobs/novaryq-worker/run; sleep 5; done"

log "6. Novaryq console: API key + webhook subscription for Flavrly"
set -a; . "$STATE/nq.env"; . "$STATE/fl.env"; set +a
if [ ! -f "$STATE/link.env" ]; then
  node "$HERE/link-novaryq.mjs" "http://127.0.0.1:$NQ_API_PORT" "$NQ_OWNER_EMAIL" "$NQ_OWNER_PASSWORD" \
    "http://127.0.0.1:$FL_PORT/api/integrations/novaryq/webhook/$FL_RESTAURANT_ID" >"$STATE/link.env"
fi
{ cat "$STATE/nq.env" "$STATE/fl.env" "$STATE/link.env"
  echo "FL_URL=$FL_URL"; echo "NQ_WEB=http://localhost:$NQ_WEB_PORT"; echo "NQ_API=http://127.0.0.1:$NQ_API_PORT"
  echo "INTERNAL_CRON_SECRET=$CRON_SECRET"; } >"$STATE/demo.env"

cat <<EOF

Stack is up (local only):
  Flavrly        $FL_URL            admin: $FL_ADMIN_EMAIL / $FL_ADMIN_PASSWORD (2FA enrolment on first sign-in)
                                         customer: $FL_CUSTOMER_PHONE, rider: $FL_RIDER_PHONE (test accounts: OTP shown on screen)
  Novaryq web    http://localhost:$NQ_WEB_PORT  /admin  $NQ_OWNER_EMAIL / $NQ_OWNER_PASSWORD   /kds   /pos (PINs 2468 cook, 1357 manager)
  Novaryq API    http://127.0.0.1:$NQ_API_PORT
  state + logs   $STATE
EOF
if [ "${1:-}" = "--record" ]; then DEMO_STATE="$STATE" "$HERE/run-demo.sh"; fi
