#!/usr/bin/env bash
#
# Runs ON THE VPS. A small, fixed set of owner-triggered maintenance actions,
# invoked by .github/workflows/server-ops.yml (Actions → "Server ops" → Run workflow).
#
#   bash scripts/server-ops.sh status            # read-only: commit, pm2, cron, env NAMES, firing alerts
#   bash scripts/server-ops.sh install-cron      # install deploy/flavrly-jobs.cron into /etc/cron.d (needs sudo -n)
#   bash scripts/server-ops.sh novaryq-on        # NOVARYQ_INTEGRATION_ENABLED=true in .env, then restart rm-web
#   bash scripts/server-ops.sh novaryq-off       # NOVARYQ_INTEGRATION_ENABLED=false in .env, then restart rm-web
#   bash scripts/server-ops.sh signups-open      # ALLOW_CUSTOMER_SELF_SIGNUP=true (anyone can sign up), restart
#   bash scripts/server-ops.sh signups-closed    # ALLOW_CUSTOMER_SELF_SIGNUP=false (invite-only), restart
#
# Never prints secret values: env checks report only whether a name is set.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
WEB_DIR="$APP_DIR/apps/web"
PM2_APP="${PM2_APP:-rm-web}"
CRON_SRC="$APP_DIR/deploy/flavrly-jobs.cron"
CRON_DST=/etc/cron.d/flavrly-jobs

load_node() {
  command -v npm >/dev/null 2>&1 && return 0
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1090
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use --silent default >/dev/null 2>&1 || true
  if ! command -v npm >/dev/null 2>&1 && [ -d "$NVM_DIR/versions/node" ]; then
    latest="$(ls -1 "$NVM_DIR/versions/node" | sort -V | tail -1)"
    export PATH="$NVM_DIR/versions/node/$latest/bin:$PATH"
  fi
  command -v npm >/dev/null 2>&1
}

env_set() { grep -qE "^$1=.+" "$WEB_DIR/.env" 2>/dev/null && echo set || echo MISSING; }
env_val_public() { grep -E "^$1=" "$WEB_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'" || true; }

status() {
  echo "== commit";  git -C "$APP_DIR" log --oneline -1
  echo "== pm2";     pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const p of JSON.parse(s||"[]"))console.log(p.name, p.pm2_env.status, "restarts="+p.pm2_env.restart_time)})' || pm2 ls
  echo "== cron"
  if [ -f "$CRON_DST" ]; then
    if cmp -s "$CRON_SRC" "$CRON_DST"; then echo "installed, matches repo"; else echo "installed, DIFFERS from repo (run install-cron)"; fi
  else echo "NOT installed"; fi
  echo "== env (names only)"
  for k in DATABASE_URL NEXTAUTH_URL NEXTAUTH_SECRET INTERNAL_CRON_SECRET NOTIFIER_SMS NOTIFIER_EMAIL NOTIFIER_WHATSAPP \
           GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET NEXT_PUBLIC_SUPPORT_PHONE; do
    printf '  %-28s %s\n' "$k" "$(env_set "$k")"
  done
  # Non-secret flags: show their values.
  for k in NOVARYQ_INTEGRATION_ENABLED FLAVRLY_PG_NEW_PAYMENTS_ENABLED ALLOW_CUSTOMER_SELF_SIGNUP NOTIFIER_SMS NOTIFIER_EMAIL; do
    printf '  %-28s = %s\n' "$k" "$(env_val_public "$k")"
  done
  echo "== firing alerts"
  load_node >/dev/null && (cd "$WEB_DIR" && npx tsx scripts/obs-firing.ts) || echo "  (could not query alerts)"
  echo "== disk"; df -h / | tail -1
}

install_cron() {
  [ -f "$CRON_SRC" ] || { echo "missing $CRON_SRC"; exit 2; }
  if ! sudo -n true 2>/dev/null; then
    echo "ERROR: the deploy user has no passwordless sudo, so /etc/cron.d cannot be written from here."
    echo "Run once as root:  install -m 0644 $CRON_SRC $CRON_DST"
    exit 3
  fi
  sudo -n install -m 0644 "$CRON_SRC" "$CRON_DST"
  echo "installed $CRON_DST ($(grep -cE '^[^#[:space:]].* curl ' "$CRON_DST") jobs)"
}

set_flag() {
  local key="$1" val="$2" f="$WEB_DIR/.env"
  cp "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"
  if grep -qE "^$key=" "$f"; then
    sed -i -E "s|^$key=.*|$key=$val|" "$f"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$f"
  fi
  echo "$key=$(env_val_public "$key")"
  # Plain restart: Next reads .env at boot. (--update-env would copy this
  # non-interactive shell's environment into pm2 and could clobber values.)
  pm2 restart "$PM2_APP" >/dev/null && pm2 save >/dev/null
  sleep 8
  curl -fsS --max-time 10 http://127.0.0.1:3000/api/health && echo
}

load_node || true
case "${1:-}" in
  status) status ;;
  install-cron) install_cron ;;
  novaryq-on) set_flag NOVARYQ_INTEGRATION_ENABLED true ;;
  novaryq-off) set_flag NOVARYQ_INTEGRATION_ENABLED false ;;
  signups-open) set_flag ALLOW_CUSTOMER_SELF_SIGNUP true ;;
  signups-closed) set_flag ALLOW_CUSTOMER_SELF_SIGNUP false ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
