#!/usr/bin/env bash
#
# Flavrly go-live (PR #29 + PR #30). Run FROM YOUR LAPTOP:
#
#   bash scripts/go-live.sh preflight     # read-only report, changes nothing
#   bash scripts/go-live.sh backup        # pg_dump of production to the VPS + copy to laptop
#   bash scripts/go-live.sh migrate       # baseline (only if needed) + prisma migrate deploy
#   bash scripts/go-live.sh deploy        # pull main, build, pm2 restart (deploy-remote.sh)
#   bash scripts/go-live.sh post          # seeds, KYC file move, jobs cron check, health check
#   bash scripts/go-live.sh all           # preflight → backup → migrate → deploy → post, pausing for "yes"
#
# Rollback: bash scripts/go-live.sh rollback <git-sha-before>   (code only; restore DB from the backup if a
# migration must be undone — migrations here are additive, so code rollback is normally enough).
#
# Safety: every step that changes production asks you to type "yes". FLAVRLY_PG_NEW_PAYMENTS_ENABLED is
# checked and must not be "true".
set -euo pipefail

HOST="${FLAVRLY_HOST:-deploy@148.230.66.124}"
KEY="${FLAVRLY_SSH_KEY:-$HOME/.ssh/maverick-actions-deploy}"
APP_DIR="${APP_DIR:-/opt/restaurant-manager}"
TS="$(date +%Y%m%d-%H%M%S)"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes "$HOST")

# Migrations that exist on main before these PRs. On a database that was only ever `db push`ed they
# must be marked applied once (they are not idempotent), see docs/flavrly-pg/DATABASE_MIGRATIONS.md §4.
OLD_MIGRATIONS=(0_init 20260520_packaging_fee 20260526_bogo_offers 20260526_food_license
  20260526_integration_provider_sms 20260526_refund_destination 20260526_user_suspension
  20260527_settlement_config 20260527_storefront_cms 20260530_restaurant_sort_order
  20260705_iam_platform_roles 20260706_approval_requests 20260801_phonepe_payment_gateway
  20261019_order_feedback_share_publicly)

confirm() { read -r -p "$1 Type 'yes' to continue: " a; [ "$a" = "yes" ] || { echo "stopped."; exit 1; }; }
remote() { "${SSH[@]}" "bash -lc $(printf '%q' "set -euo pipefail; cd $APP_DIR/apps/web; $1")"; }

preflight() {
  echo "== production preflight (read-only)"
  remote 'echo "live commit: $(git -C '"$APP_DIR"' log --oneline -1)"; echo "branch: $(git -C '"$APP_DIR"' rev-parse --abbrev-ref HEAD)";
          git -C '"$APP_DIR"' fetch -q origin main; echo "origin/main: $(git -C '"$APP_DIR"' log --oneline -1 origin/main)";
          pm2 ls | sed -n "1,20p"; df -h / | tail -1;
          v=$(grep -E "^FLAVRLY_PG_NEW_PAYMENTS_ENABLED=" .env | cut -d= -f2- || true); echo "FLAVRLY_PG_NEW_PAYMENTS_ENABLED=${v:-<unset>}";
          [ "${v:-}" = "true" ] && { echo "REFUSING: PG new payments must stay off"; exit 3; } || true;
          echo "--- migrate status (current code)"; npx prisma migrate status || true'
}

backup() {
  confirm "Back up the production database now?"
  # Read ONLY DATABASE_URL from .env (sourcing the whole file breaks on any malformed line), and drop
  # Prisma's ?schema=public query — pg_dump rejects it ("invalid URI query parameter").
  remote 'DATABASE_URL=$(grep -E "^DATABASE_URL=" .env | tail -1 | cut -d= -f2- | tr -d "\"\047");
          [ -n "$DATABASE_URL" ] || { echo "DATABASE_URL not found in .env"; exit 4; }; mkdir -p ~/predeploy-backups;
          pg_dump -Fc "${DATABASE_URL%%\?*}" > ~/predeploy-backups/flavrly-'"$TS"'.dump;
          ls -lh ~/predeploy-backups/flavrly-'"$TS"'.dump; pg_restore -l ~/predeploy-backups/flavrly-'"$TS"'.dump | head -3'
  mkdir -p "$HOME/flavrly-backups"
  scp -i "$KEY" -o IdentitiesOnly=yes "$HOST:predeploy-backups/flavrly-$TS.dump" "$HOME/flavrly-backups/" && echo "copied to ~/flavrly-backups/flavrly-$TS.dump"
}

migrate() {
  confirm "Pull origin/main on the VPS and apply database migrations?"
  remote 'git -C '"$APP_DIR"' rev-parse HEAD > ~/predeploy-backups/sha-before-'"$TS"'; git -C '"$APP_DIR"' pull --ff-only origin main;
          npm install --no-audit --no-fund; npx prisma generate >/dev/null'
  echo "== migrate status on the new code"
  if remote 'npx prisma migrate status' ; then echo "status ok"; else echo "(status reported pending/failed — inspecting)"; fi
  if remote 'npx prisma migrate status 2>&1 | grep -qE "^[[:space:]]*0_init[[:space:]]*$|P3005|_prisma_migrations.*does not exist"'; then
    echo "Database looks db-push-managed (old migrations not recorded)."
    confirm "Mark the ${#OLD_MIGRATIONS[@]} pre-existing migrations as applied (no SQL runs)?"
    for m in "${OLD_MIGRATIONS[@]}"; do remote "npx prisma migrate resolve --applied $m || true"; done
  fi
  confirm "Run 'prisma migrate deploy' (additive migrations, guarded catch-up)?"
  remote 'npx prisma migrate deploy && npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code && echo "DB matches schema"'
}

deploy() {
  confirm "Build and restart the production app (scripts/deploy-remote.sh)?"
  "${SSH[@]}" "bash -lc 'cd $APP_DIR && APP_COMMIT_SHA=\$(git rev-parse --short HEAD) bash scripts/deploy-remote.sh'"
}

post() {
  confirm "Run post-deploy steps (help/training seeds, KYC files to private storage)?"
  remote 'npm run db:seed:help -- --update; npm run db:seed:training; npx tsx scripts/migrate-kyc-private.ts --apply || echo "KYC move script: check output"'
  echo "== cron: the jobs file must be installed by root:"
  echo "   sudo cp $APP_DIR/deploy/flavrly-jobs.cron /etc/cron.d/flavrly-jobs && sudo chmod 644 /etc/cron.d/flavrly-jobs"
  echo "== nginx (root): install deploy/portal.flavrly.in.conf changes (KYC private path block, 210M APK upload) then: sudo nginx -t && sudo systemctl reload nginx"
  health
}

health() {
  echo "== health"
  curl -fsS --max-time 10 https://flavrly.in/api/health && echo
  for p in / /faq /rider /rider-app /contact /login; do printf "%-12s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://flavrly.in$p")"; done
}

rollback() {
  sha="${1:?usage: rollback <sha>}"
  confirm "Roll production code back to $sha?"
  "${SSH[@]}" "bash -lc 'cd $APP_DIR && git checkout -q $sha && cd apps/web && npm install --no-audit --no-fund && npm run build && pm2 restart rm-web'"
}

case "${1:-}" in
  preflight) preflight ;; backup) backup ;; migrate) migrate ;; deploy) deploy ;; post) post ;; health) health ;;
  rollback) shift; rollback "$@" ;;
  all) preflight; backup; migrate; deploy; post ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
