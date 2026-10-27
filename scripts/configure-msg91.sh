#!/usr/bin/env bash
#
# Runs ON THE VPS (invoked by .github/workflows/configure-sms.yml). Writes the
# MSG91 SMS configuration into apps/web/.env and switches the platform to real
# SMS delivery, then restarts rm-web and health-checks.
#
# Required env (passed by the workflow):
#   MSG91_AUTH_KEY           (secret; from GitHub Actions secret)
#   MSG91_SENDER_ID          6-char DLT-approved sender/header
#   MSG91_OTP_TEMPLATE_ID    MSG91 OTP template/flow id (for login & phone verify)
#   MSG91_TXN_DLT_TEMPLATE_ID DLT template id for transactional SMS (order/alert texts)
# Optional:
#   MSG91_ROUTE              default 4 (transactional)
#
# It sets in .env: NOTIFIER_SMS=msg91, the MSG91_* values (code reads
# MSG91_TEMPLATE_ID for OTP and MSG91_DLT_TEMPLATE_ID for transactional), and
# OTP_DEMO_MODE=false (codes stop surfacing on screen the moment real SMS is on).
# Never prints the auth key.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
WEB_DIR="$APP_DIR/apps/web"
PM2_APP="${PM2_APP:-rm-web}"
ENV="$WEB_DIR/.env"

: "${MSG91_AUTH_KEY:?MSG91_AUTH_KEY not provided (add it as a GitHub Actions secret)}"
: "${MSG91_SENDER_ID:?MSG91_SENDER_ID not provided}"
: "${MSG91_OTP_TEMPLATE_ID:?MSG91_OTP_TEMPLATE_ID not provided}"
: "${MSG91_TXN_DLT_TEMPLATE_ID:?MSG91_TXN_DLT_TEMPLATE_ID not provided}"
MSG91_ROUTE="${MSG91_ROUTE:-4}"

load_node() {
  command -v npm >/dev/null 2>&1 && return 0
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1090
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use --silent default >/dev/null 2>&1 || true
  if ! command -v npm >/dev/null 2>&1 && [ -d "$NVM_DIR/versions/node" ]; then
    export PATH="$NVM_DIR/versions/node/$(ls -1 "$NVM_DIR/versions/node" | sort -V | tail -1)/bin:$PATH"
  fi
  command -v npm >/dev/null 2>&1
}

# upsert KEY=VALUE in .env (value passed literally; no shell expansion)
set_env() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" "$ENV"; then
    # Use a temp file to avoid sed quoting issues with arbitrary values.
    grep -vE "^${k}=" "$ENV" > "$ENV.tmp"
    printf '%s=%s\n' "$k" "$v" >> "$ENV.tmp"
    mv "$ENV.tmp" "$ENV"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV"
  fi
}

[ -f "$ENV" ] || { echo "ERROR: $ENV not found"; exit 2; }
cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"

set_env NOTIFIER_SMS msg91
set_env MSG91_AUTH_KEY "$MSG91_AUTH_KEY"
set_env MSG91_SENDER_ID "$MSG91_SENDER_ID"
set_env MSG91_TEMPLATE_ID "$MSG91_OTP_TEMPLATE_ID"
set_env MSG91_DLT_TEMPLATE_ID "$MSG91_TXN_DLT_TEMPLATE_ID"
set_env MSG91_ROUTE "$MSG91_ROUTE"
set_env OTP_DEMO_MODE false

echo "Applied MSG91 config (auth key length ${#MSG91_AUTH_KEY}, not shown):"
echo "  NOTIFIER_SMS       = msg91"
echo "  MSG91_SENDER_ID    = $MSG91_SENDER_ID"
echo "  MSG91_TEMPLATE_ID  = $MSG91_OTP_TEMPLATE_ID    (OTP)"
echo "  MSG91_DLT_TEMPLATE_ID = $MSG91_TXN_DLT_TEMPLATE_ID  (transactional)"
echo "  MSG91_ROUTE        = $MSG91_ROUTE"
echo "  OTP_DEMO_MODE      = false"

load_node || true
# Plain restart: Next reads .env at boot. The boot guard in otp.ts hard-fails if
# a real provider is set while OTP_DEMO_MODE is on — which is why we set it false
# above; if rm-web does not come back healthy, that guard (or a bad value) is why.
pm2 restart "$PM2_APP" >/dev/null && pm2 save >/dev/null
sleep 10
if curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null; then
  echo "rm-web healthy after restart. Real SMS is now live."
else
  echo "WARNING: health check did not pass after restart. Check 'pm2 logs rm-web' for a boot error (e.g. OTP demo-mode guard)."
  exit 4
fi
