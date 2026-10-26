# Go-live runbook — PR #29 (Flavrly PG, safe-pilot) + PR #30 (round 2/3 features and fixes)

Both PRs are merged into `main`. **Production is not changed by the merge**: the GitHub deploy job now requires the
`VPS_KNOWN_HOSTS` secret and stops at "Configure SSH" until it exists. Go live with `scripts/go-live.sh` (from your
laptop, needs `~/.ssh/maverick-actions-deploy`) — every changing step asks you to type `yes`.

Release gate (local, merge commit of both PRs): migrate deploy from empty (33 migrations) + drift 0, typecheck, lint,
responsive, test:ci ×3 (2508 tests), test:db (238), production build, rider-native typecheck/lint, gitleaks.
Logs: `~/flavrly-pg-evidence/2026-10-24/release-merge/`.

## Steps (≈20 min)

| # | Command | What it does |
|---|---|---|
| 1 | `bash scripts/go-live.sh preflight` | Read-only: live commit, pm2, disk, `migrate status`. Refuses if `FLAVRLY_PG_NEW_PAYMENTS_ENABLED=true`. |
| 2 | `bash scripts/go-live.sh backup` | `pg_dump -Fc` on the VPS (`~/predeploy-backups/`) and a copy to `~/flavrly-backups/`. |
| 3 | `bash scripts/go-live.sh migrate` | Pulls `main`; if the DB was only ever `db push`ed, marks the 14 pre-existing migrations applied (no SQL); runs `prisma migrate deploy` (additive; the catch-up migration is guarded); verifies DB == schema. |
| 4 | `bash scripts/go-live.sh deploy` | `scripts/deploy-remote.sh`: install, build (keeps the previous build if it fails), `pm2 restart rm-web`. |
| 5 | `bash scripts/go-live.sh post` | Help + training seeds, KYC files → private storage, health check of key pages. Prints the two root-only commands below. |
| 6 | (root) `sudo cp /opt/restaurant-manager/deploy/flavrly-jobs.cron /etc/cron.d/flavrly-jobs && sudo chmod 644 /etc/cron.d/flavrly-jobs` | New jobs: review requests/digest, dispatch JIT/stationary/zones/prep stats, observability alerts/retention, escalations scan, rider heartbeat, pg-worker. |
| 7 | (root) install `deploy/portal.flavrly.in.conf` changes, `sudo nginx -t && sudo systemctl reload nginx` | KYC public path blocked, 210M APK upload location. |
| 8 | GitHub → Settings → Secrets → `VPS_KNOWN_HOSTS` = the VPS host key line (`ssh-keygen -F 148.230.66.124` on your laptop prints it) | Re-enables CI deploys for future merges. |

Rollback (code): `bash scripts/go-live.sh rollback <sha>` (the pre-deploy sha is saved in `~/predeploy-backups/sha-before-*`).
Migrations are additive, so the old code runs on the new schema; restore the dump only if data must be reverted.

## Decisions at launch
- **Rider KYC gate** (default ON): riders without approved, in-date documents stop receiving new orders (3-day grace).
  Toggle in `/platform/rider-settings` — it shows how many riders it blocks before you confirm.
- **Flavrly PG direct UPI** stays OFF (`FLAVRLY_PG_NEW_PAYMENTS_ENABLED` unset/false) until bank/legal/licence gates
  in `docs/flavrly-pg/FINAL_GO_NO_GO.md` are met.
- **JIT rider invites** stay OFF until ~1 week of kitchen "Food ready" taps (`/platform/dispatch-insights`).
- Root `apps/web/instrumentation.ts` (Redis boot) is dormant because Next loads `src/instrumentation.ts`; enabling Redis
  is a separate decision.

## Owner follow-ups
- Super admins: sign in with TOTP (observability needs a 2FA session). Platform-team users enrol TOTP at next login.
- Rider app: `eas build -p android --profile preview` (or production), publish at `/platform/app-releases`; Play Console
  background-location declaration + demo video; App Store "Always" location note.
- WhatsApp Utility templates (review ask, alerts/digest), DLT SMS templates (`review.request`, transactional), Google
  Business Profile API approval; optional `TWOFACTOR_TSMS_TEMPLATE_NAME`, `TRUST_CF=true` (only if origin is
  firewalled to Cloudflare), `APP_COMMIT_SHA`, `NEXT_PUBLIC_SUPPORT_PHONE/WHATSAPP` (call/WhatsApp buttons hidden until set).
- Backups: set `BACKUP_AGE_RECIPIENT` and run `deploy/restore-drill.sh` once.
