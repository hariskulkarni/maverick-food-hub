#!/usr/bin/env bash
# Integrated demo — record the story (LOCAL ONLY). Needs a stack started by up.sh.
#   scripts/integrated-demo/run-demo.sh
# Copies the spec into the scratch Flavrly worktree (so it resolves @playwright/test + otplib from
# its node_modules), resets the demo admin's 2FA (the run enrols it like a first-time owner),
# warms the dev-server routes, runs Playwright with system Chrome, then builds the README index
# and a stitched video into $DEMO_OUT.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/demo.conf"
set -a; . "$STATE/demo.env"; set +a

cp "$HERE/demo.spec.ts" "$HERE/playwright.config.ts" "$FL_WT/apps/web/qa-demo/"
psql "$FL_DB_URL" -q -c "UPDATE \"User\" SET \"totpSecret\"=NULL,\"totpPendingSecret\"=NULL,\"totpEnabledAt\"=NULL,\"totpLastStep\"=NULL WHERE email='$FL_ADMIN_EMAIL'" \
  -c "DELETE FROM \"TotpRecoveryCode\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE email='$FL_ADMIN_EMAIL')" \
  -c "DELETE FROM \"LoginAttempt\" WHERE true" 2>/dev/null || true

echo "warming Flavrly dev routes (first compile is slow)…"
# Pages, then API routes (a GET on a POST-only route still compiles its module).
for p in /login /admin /admin/onboarding /admin/integrations "/r/$FL_RESTAURANT_SLUG" /checkout /orders /rider/login /rider \
  /api/auth/otp /api/auth/otp/test-account /api/auth/staff/precheck /api/auth/staff/enroll /api/auth/restaurants \
  /api/auth/callback/email-password /api/auth/callback/phone-otp /api/auth/session /api/admin/active-restaurant \
  /api/admin/integrations/novaryq /api/admin/integrations/novaryq/locations /api/admin/integrations/novaryq/import \
  /api/admin/integrations/novaryq/items /api/admin/integrations/novaryq/syncs /api/me /api/checkout/quote /api/orders \
  /api/customer/delivery-eta "/api/integrations/novaryq/webhook/warmup" /api/platform/jobs/novaryq-worker/run \
  /api/platform/jobs/novaryq-reconcile/run /api/rider/auth /api/rider/pool /api/rider/assignments; do
  curl -s -o /dev/null --max-time 300 "$FL_URL$p" || true
done

if [ "${DEMO_APPEND:-}" != 1 ]; then rm -rf "$DEMO_OUT"; fi; mkdir -p "$DEMO_OUT"
( cd "$FL_WT/apps/web" && DEMO_OUT="$DEMO_OUT" DEMO_APPEND="${DEMO_APPEND:-}" DEMO_ONLY="${DEMO_ONLY:-}" nice -n 5 npx playwright test -c qa-demo/playwright.config.ts ) || STATUS=$?
node "$HERE/make-readme.mjs" "$DEMO_OUT" || true
exit "${STATUS:-0}"
