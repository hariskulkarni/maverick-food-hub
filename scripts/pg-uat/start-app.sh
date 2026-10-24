#!/usr/bin/env bash
# Starts the built Flavrly app (next start, NODE_ENV=production) on :3311 against ci_uat.
set -euo pipefail
. "$(dirname "$0")/env.sh"
cd "$WT_APP/apps/web"
set -a; . "$UAT_DIR/app.env"; [ -f "$UAT_DIR/app.override.env" ] && . "$UAT_DIR/app.override.env"; set +a
export NODE_ENV=production
nohup ./node_modules/.bin/next start -H 127.0.0.1 -p 3311 >> "$EVID/logs/app.log" 2>&1 & echo $! > "$UAT_DIR/app.pid"
for i in $(seq 1 60); do curl -fsS -o /dev/null "$APP/api/system/health" 2>/dev/null && { echo "app up (pid $(cat "$UAT_DIR/app.pid"))"; exit 0; }; sleep 1; done
echo "app did not come up"; exit 1
