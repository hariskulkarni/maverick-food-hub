#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Flavrly — PhonePe post-deploy setup for the production VPS
#
#  Run this ON THE VPS, as the `deploy` user, AFTER deploy/deploy.sh has shipped
#  the PhonePe branch. It is idempotent: safe to run repeatedly, and it never
#  overwrites a value you have already set.
#
#      cd /opt/restaurant-manager
#      ./deploy/phonepe-setup.sh check      # read-only audit (default)
#      ./deploy/phonepe-setup.sh apply      # fill gaps in apps/web/.env
#      sudo ./deploy/phonepe-setup.sh cron  # install /etc/cron.d/flavrly-jobs
#
#  What `apply` does:
#    - adds INTERNAL_CRON_SECRET (generated) if absent — required by FOUR
#      scheduled jobs, not just PhonePe
#    - adds NEXT_PUBLIC_SITE_URL if absent
#    - adds the PHONEPE_* block with REPLACE_ME placeholders if absent
#    - leaves PAYMENT_PROVIDER alone; if absent it writes "razorpay"
#
#  What it deliberately does NOT do:
#    - never sets PAYMENT_PROVIDER=phonepe (that is your go-live switch)
#    - never overwrites an existing key
#    - never prints a secret value to stdout
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/restaurant-manager}"
WEB_DIR="$APP_ROOT/apps/web"
ENV_FILE="$WEB_DIR/.env"
SITE_URL="${SITE_URL:-https://flavrly.in}"
CRON_DEST="/etc/cron.d/flavrly-jobs"
CRON_SRC="$APP_ROOT/deploy/flavrly-jobs.cron"

MODE="${1:-check}"

c_ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
c_warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
c_bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
hdr()    { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ── has_key KEY — is KEY set to a non-empty, non-placeholder value? ──────────
has_key() {
  local k="$1" v
  [[ -f "$ENV_FILE" ]] || return 1
  v="$(grep -E "^[[:space:]]*${k}=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  v="${v%\"}"; v="${v#\"}"
  [[ -n "$v" && "$v" != "REPLACE_ME" && "$v" != *REPLACE_ME* ]]
}

key_present() {
  [[ -f "$ENV_FILE" ]] && grep -qE "^[[:space:]]*$1=" "$ENV_FILE"
}

# ── sanity ──────────────────────────────────────────────────────────────────
[[ -d "$WEB_DIR" ]] || { echo "No $WEB_DIR — is APP_ROOT right?" >&2; exit 1; }

case "$MODE" in
  check|apply|cron) ;;
  *) echo "Usage: $0 [check|apply|cron]" >&2; exit 2 ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "cron" ]]; then
  hdr "Installing scheduled jobs"
  [[ $EUID -eq 0 ]] || { echo "cron mode needs root: sudo $0 cron" >&2; exit 1; }
  [[ -f "$CRON_SRC" ]] || { echo "Missing $CRON_SRC" >&2; exit 1; }

  if ! grep -q "INTERNAL_CRON_SECRET" "$ENV_FILE" 2>/dev/null; then
    c_bad "INTERNAL_CRON_SECRET is not in $ENV_FILE — run '$0 apply' first"
    exit 1
  fi

  install -m 0644 "$CRON_SRC" "$CRON_DEST"
  c_ok "installed $CRON_DEST"
  c_warn "the cron file reads INTERNAL_CRON_SECRET from $ENV_FILE at run time"
  echo
  grep -vE '^\s*#' "$CRON_DEST" | grep -v '^\s*$' || true
  echo
  c_ok "cron picks up /etc/cron.d automatically — no restart needed"
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
if [[ "$MODE" == "apply" ]]; then
  hdr "Filling gaps in $ENV_FILE"
  [[ -f "$ENV_FILE" ]] || { echo "No $ENV_FILE. Copy deploy/.env.production.example first." >&2; exit 1; }

  cp -a "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  c_ok "backed up existing .env"

  added=0
  {
    key_present PAYMENT_PROVIDER    || { printf '\n# ─── Payments (added by phonepe-setup.sh) ───\nPAYMENT_PROVIDER="razorpay"\n'; }
    key_present NEXT_PUBLIC_SITE_URL || { printf 'NEXT_PUBLIC_SITE_URL="%s"\n' "$SITE_URL"; }
    key_present INTERNAL_CRON_SECRET || { printf 'INTERNAL_CRON_SECRET="%s"\n' "$(openssl rand -hex 32)"; }
    if ! key_present PHONEPE_CLIENT_ID; then
      cat <<'BLOCK'

# ─── PhonePe Standard Checkout V2 ───
# From PhonePe Business Dashboard → Developer Settings → API Keys.
# Production credentials appear only after KYC verification completes.
PHONEPE_CLIENT_ID="REPLACE_ME"
PHONEPE_CLIENT_SECRET="REPLACE_ME"
PHONEPE_CLIENT_VERSION="1"
PHONEPE_ENV="SANDBOX"
# Must match the pair registered under Developer Settings → Webhooks (auth: SHA)
PHONEPE_WEBHOOK_USERNAME="REPLACE_ME"
PHONEPE_WEBHOOK_PASSWORD="REPLACE_ME"
BLOCK
    fi
  } >> "$ENV_FILE"

  for k in PAYMENT_PROVIDER NEXT_PUBLIC_SITE_URL INTERNAL_CRON_SECRET PHONEPE_CLIENT_ID; do
    key_present "$k" && c_ok "$k present" || { c_bad "$k still missing"; added=1; }
  done

  chmod 600 "$ENV_FILE"
  c_ok "chmod 600 $ENV_FILE"
  c_warn "reload PM2 to pick up new env:  pm2 reload rm-web rm-worker --update-env"
  echo
  echo "Now run '$0 check' to verify the endpoints."
  exit $added
fi

# ─────────────────────────────────────────────────────────────────────────────
# check
FAIL=0

hdr "1. Environment ($ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  c_bad "missing — copy deploy/.env.production.example and fill it in"
  exit 1
fi
for k in DATABASE_URL NEXTAUTH_URL PAYMENT_PROVIDER NEXT_PUBLIC_SITE_URL INTERNAL_CRON_SECRET; do
  if has_key "$k"; then c_ok "$k set"; else c_bad "$k missing or placeholder"; FAIL=1; fi
done
for k in PHONEPE_CLIENT_ID PHONEPE_CLIENT_SECRET PHONEPE_CLIENT_VERSION PHONEPE_ENV \
         PHONEPE_WEBHOOK_USERNAME PHONEPE_WEBHOOK_PASSWORD; do
  if has_key "$k"; then c_ok "$k set"; else c_warn "$k not set yet (expected until KYC clears)"; fi
done

PROVIDER="$(grep -E '^[[:space:]]*PAYMENT_PROVIDER=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
PPENV="$(grep -E '^[[:space:]]*PHONEPE_ENV=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
if [[ "$PROVIDER" == "phonepe" && "$PPENV" != "PRODUCTION" ]]; then
  c_bad "PAYMENT_PROVIDER=phonepe but PHONEPE_ENV=$PPENV — real customers would hit the sandbox"
  FAIL=1
else
  c_ok "provider=$PROVIDER phonepe_env=${PPENV:-unset}"
fi

hdr "2. Database migration"
cd "$WEB_DIR"
if npx prisma migrate status 2>&1 | grep -q "Database schema is up to date"; then
  c_ok "schema up to date"
else
  c_warn "pending migrations — deploy.sh runs 'prisma migrate deploy'"
  npx prisma migrate status 2>&1 | tail -5 | sed 's/^/      /'
fi

hdr "3. Routes reachable (this is what PhonePe's validator sees)"
probe() {
  local method="$1" path="$2" expect="$3"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -X "$method" --max-time 10 "$SITE_URL$path" || echo 000)"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    c_bad "$method $path → $code   (expected $expect — route not deployed?)"
    FAIL=1
  else
    c_ok "$method $path → $code   (expected $expect)"
  fi
}
probe POST /api/payments/phonepe/webhook "401 unauthorised"
probe GET  /api/payments/phonepe/webhook "405 method not allowed"
probe GET  /api/payments/phonepe/return  "302/303 redirect"

hdr "4. Reconciliation sweep"
SECRET="$(grep -E '^[[:space:]]*INTERNAL_CRON_SECRET=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
if [[ -z "$SECRET" || "$SECRET" == "REPLACE_ME" ]]; then
  c_bad "INTERNAL_CRON_SECRET unset — the sweep cannot authenticate"
  FAIL=1
else
  code="$(curl -s -o /tmp/pp-sweep.json -w '%{http_code}' -X POST --max-time 30 \
        -H "x-internal-secret: $SECRET" "$SITE_URL/api/platform/jobs/phonepe-reconcile/run" || echo 000)"
  if [[ "$code" == "200" ]]; then
    c_ok "sweep responded 200"
    sed 's/^/      /' /tmp/pp-sweep.json 2>/dev/null | head -3
  else
    c_bad "sweep returned $code"
    FAIL=1
  fi
  rm -f /tmp/pp-sweep.json
fi

hdr "5. Cron"
if [[ -f "$CRON_DEST" ]]; then
  c_ok "$CRON_DEST installed"
  grep -c 'jobs/' "$CRON_DEST" | xargs -I{} echo "      {} job lines"
else
  c_bad "$CRON_DEST missing — run: sudo $0 cron"
  FAIL=1
fi

hdr "Result"
if [[ $FAIL -eq 0 ]]; then
  c_ok "All checks passed."
  echo
  echo "  Next: register the webhook in the PhonePe dashboard"
  echo "    Developer Settings → Webhooks → Create New Webhook"
  echo "    URL      $SITE_URL/api/payments/phonepe/webhook"
  echo "    Auth     SHA (username and password)"
  echo "    Events   checkout.order.completed  checkout.order.failed"
  echo "             pg.refund.completed       pg.refund.failed"
  echo
  echo "  PhonePe live-probes that URL and refuses to save if it 404s."
  echo "  If it still refuses once section 3 above is green, PhonePe is"
  echo "  demanding a 2xx rather than mere reachability — say so and the"
  echo "  webhook route can grow a GET handler that returns 200."
else
  c_bad "Some checks failed — see above."
fi
exit $FAIL
