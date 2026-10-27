#!/usr/bin/env bash
#
# Runs ON THE VPS (via .github/workflows/configure-google-signin.yml). Cleans and
# optionally replaces the Google *sign-in* OAuth creds in apps/web/.env, then
# restarts rm-web and health-checks. Fixes values pasted with stray <...> /
# quotes / whitespace, and lets the owner correct the client id/secret.
#
# Env (from the workflow):
#   GOOGLE_SIGNIN_CLIENT_ID      optional — if set, replaces GOOGLE_CLIENT_ID
#   GOOGLE_SIGNIN_CLIENT_SECRET  optional secret — if set, replaces GOOGLE_CLIENT_SECRET
# With neither set, it just strips <>/quotes/whitespace from the existing values.
# The client id is public and printed back for verification; the secret never is.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
WEB_DIR="$APP_DIR/apps/web"
PM2_APP="${PM2_APP:-rm-web}"
ENV="$WEB_DIR/.env"
[ -f "$ENV" ] || { echo "ERROR: $ENV not found"; exit 2; }

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

clean() { # strip surrounding whitespace, angle brackets and quotes
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"; v="${v%"${v##*[![:space:]]}"}"   # trim ws
  v="${v#<}"; v="${v%>}"                                          # strip < >
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"              # strip quotes
  printf '%s' "$v"
}
get_env() { grep -E "^$1=" "$ENV" | tail -1 | cut -d= -f2- || true; }
set_env() {
  local k="$1" v="$2"
  grep -vE "^${k}=" "$ENV" > "$ENV.tmp"; printf '%s=%s\n' "$k" "$v" >> "$ENV.tmp"; mv "$ENV.tmp" "$ENV"
}

cp "$ENV" "$ENV.bak-$(date +%Y%m%d-%H%M%S)"

cid="$(clean "${GOOGLE_SIGNIN_CLIENT_ID:-$(get_env GOOGLE_CLIENT_ID)}")"
csec="$(clean "${GOOGLE_SIGNIN_CLIENT_SECRET:-$(get_env GOOGLE_CLIENT_SECRET)}")"

[ -n "$cid" ]  && set_env GOOGLE_CLIENT_ID "$cid"   || { echo "ERROR: no GOOGLE_CLIENT_ID to set"; exit 3; }
[ -n "$csec" ] && set_env GOOGLE_CLIENT_SECRET "$csec" || echo "WARNING: GOOGLE_CLIENT_SECRET is empty"

echo "GOOGLE_CLIENT_ID now = $cid"
echo "GOOGLE_CLIENT_SECRET length = ${#csec} (not shown)"

load_node || true
pm2 restart "$PM2_APP" >/dev/null && pm2 save >/dev/null
sleep 10
curl -fsS --max-time 10 http://127.0.0.1:3000/api/health >/dev/null && echo "rm-web healthy" || { echo "WARNING: health check failed; see pm2 logs rm-web"; exit 4; }
