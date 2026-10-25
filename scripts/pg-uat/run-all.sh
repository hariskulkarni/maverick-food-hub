#!/usr/bin/env bash
# Full local synthetic UAT pass from scratch (fresh ci_uat, fresh gateway SQLite, fresh build).
# Usage: UAT_DIR=... EVID=<evidence dir for this pass> scripts/pg-uat/run-all.sh
# Long-wait checks are separate: s03b (>=5 min after s03) and s06b (>=46 min after s06a).
set -euo pipefail
. "$(dirname "$0")/env.sh"
H="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$EVID/logs"
stop() { [ -f "$UAT_DIR/$1" ] && kill "$(cat "$UAT_DIR/$1")" 2>/dev/null || true; }
stop app.pid; stop gw-api.pid; stop tap.pid; sleep 2
[ -d "$UAT_DIR/tap" ] && mv "$UAT_DIR/tap" "$UAT_DIR/tap.$(date +%s)"
rm -f "$UAT_DIR/app.override.env"; echo pass > "$UAT_DIR/tap.mode"
P=(-h localhost -p 55432 -U ci)
dropdb "${P[@]}" --if-exists ci_uat; createdb "${P[@]}" ci_uat
cd "$WT_APP/apps/web"
./node_modules/.bin/prisma migrate deploy > "$EVID/00-migrate-deploy.log" 2>&1; echo "migrate deploy exit=$?"
./node_modules/.bin/tsx prisma/seed.ts > "$EVID/01-seed.log" 2>&1; echo "seed exit=$?"
rm -f "$UAT_DIR"/gw-uat.sqlite*
"$H/start-gateway.sh"
node "$H/gw-setup.mjs" | tee "$EVID/02-gateway-setup.log"
NODE_PATH=$PWD/node_modules ./node_modules/.bin/tsx --tsconfig ./tsconfig.json "$H/setup-fixtures.ts" > "$EVID/03-fixtures.log" 2>&1; echo "fixtures exit=$?"
( /usr/bin/time -p npm run build ) > "$EVID/04-app-build.log" 2>&1; echo "build exit=$?"
nohup node "$H/tap-proxy.mjs" >> "$EVID/logs/tap-proxy.log" 2>&1 & echo $! > "$UAT_DIR/tap.pid"
"$H/start-app.sh"
for s in s00-onboard s00b-approve s06a-never-paid-start s01-happy-path s01b-reimport s02a-paid-no-bank s03-dup-replay s04-gateway-sigkill s05-app-sigkill s07-disabled-merchant s08-refund; do
  echo "### $s"; node "$H/$s.mjs" > "$EVID/logs/$s.out" 2>&1 || echo "!!! $s exited $?"
  grep -E "EXPECT|FAIL" "$EVID/logs/$s.out" | cut -c1-220 || true
done
"$H/s09a-backup-drill.sh" > "$EVID/logs/s09a.out" 2>&1; grep -E "PASS|FAIL|exit" "$EVID/logs/s09a.out" || true
node "$H/s09b-flag-off.mjs" > "$EVID/logs/s09b-flag-off.out" 2>&1 || echo "!!! s09b exited $?"; grep -E "EXPECT" "$EVID/logs/s09b-flag-off.out" | cut -c1-220 || true
echo "pass done $(date -u +%FT%TZ)"
