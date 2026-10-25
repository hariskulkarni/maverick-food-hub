# Flavrly PG local synthetic UAT — shared paths. Source this file.
# Secrets are NOT stored here: they live in $UAT_DIR/*.env (throwaway, mode 600, outside git).
: "${UAT_DIR:?set UAT_DIR to the directory holding app.env / gw.env / gw-merchant.env / tls.*}"
export WT_APP="/Users/bunny../Documents/Claude/Projects/Flavrly/wt-pg-s"
export WT_GW="/Users/bunny../Documents/Claude/Projects/Flavrly/flavrly-pg/wt-s-uat"
export NODE24="/Users/bunny../Documents/Claude/Projects/Flavrly/flavrly-pg/node24/node-v24.22.1-darwin-x64/bin/node"
export EVID="${EVID:-/Users/bunny../flavrly-pg-evidence/2026-10-24/agent-s}"
export APP=http://localhost:3311 GW=http://127.0.0.1:6611
export PSQL="psql -h localhost -p 55432 -U ci -d ci_uat -X -P pager=off"
export GW_MERCHANT_ID=00000000-0000-0000-0000-000000000001
set -a; . "$UAT_DIR/app.env"; . "$UAT_DIR/gw-merchant.env"; set +a
# Gateway admin token only (needed by curl helpers); never echo it.
export GW_ADMIN_TOKEN="$(grep '^ADMIN_API_TOKEN=' "$UAT_DIR/gw.env" | cut -d= -f2-)"
