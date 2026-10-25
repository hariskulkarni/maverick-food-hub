#!/usr/bin/env bash
# Starts the fork's payment-api (6611) + checkout portal (7711) + TLS proxy (7712) from the
# detached worktree at 7720b49, Node 24, own SQLite file, throwaway secrets from $UAT_DIR/gw.env.
set -euo pipefail
. "$(dirname "$0")/env.sh"
cd "$WT_GW"
set -a; . "$UAT_DIR/gw.env"; set +a
nohup "$NODE24" apps/payment-api/src/index.js >> "$EVID/logs/gateway-api.log" 2>&1 & echo $! > "$UAT_DIR/gw-api.pid"
if ! { [ -f "$UAT_DIR/gw-checkout.pid" ] && kill -0 "$(cat "$UAT_DIR/gw-checkout.pid")" 2>/dev/null; }; then
  nohup "$NODE24" apps/checkout-portal/src/index.js >> "$EVID/logs/gateway-checkout.log" 2>&1 & echo $! > "$UAT_DIR/gw-checkout.pid"
fi
if ! { [ -f "$UAT_DIR/tls.pid" ] && kill -0 "$(cat "$UAT_DIR/tls.pid")" 2>/dev/null; }; then
  nohup "$NODE24" "$WT_APP/scripts/pg-uat/tls-proxy.mjs" >> "$EVID/logs/tls-proxy.log" 2>&1 & echo $! > "$UAT_DIR/tls.pid"
fi
for i in $(seq 1 30); do curl -fsS "$GW/health" >/dev/null 2>&1 && { echo "gateway up (pid $(cat "$UAT_DIR/gw-api.pid"))"; exit 0; }; sleep 1; done
echo "gateway did not come up"; exit 1
