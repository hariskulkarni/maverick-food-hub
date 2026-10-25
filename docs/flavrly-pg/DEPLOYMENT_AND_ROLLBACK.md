# Flavrly PG — deployment and rollback

Owner: Agent G. This is based on the scripts as they exist in the repo on 2026-10-24:
- `scripts/deploy-remote.sh`
- `scripts/deploy.sh`
- `deploy/deploy.sh`
- `.github/workflows/deploy.yml`
- `ecosystem.config.js`
- `deploy/ecosystem.config.cjs`
- `deploy/flavrly-jobs.cron`
- `deploy/backup.sh`
- `docs/YOUPI-SELF-HOST.md`
- `flavrly-pg/DEPLOY-pg-hardening.md`

**Production real-money activation is NOT authorised by this document.** It needs every gate in COMPLIANCE_AND_LICENSE_BLOCKERS.md, plus a human go/no-go (master prompt §24).

## 0. Topology (as documented, not independently verified)

| Process | Where | Port | Source |
|---|---|---|---|
| Flavrly web | `/opt/restaurant-manager/apps/web`, pm2 (`rm-web` per `deploy/ecosystem.config.cjs`, **or** `flavrly-prod` + `flavrly-demo` per root `ecosystem.config.js`) | 3000 (+3001 demo) | repo |
| Flavrly PG gateway | `/opt/youpi-pg`, pm2 `youpi-pg`, Node 24.22.1, SQLite `data/youpi_pg.sqlite` | 6100 API (localhost), 6001 admin, 7000 checkout | DEPLOY-pg-hardening.md, YOUPI-SELF-HOST.md |
| Postgres | VPS | — | `deploy/backup.sh` |
| Cron | `/etc/cron.d/flavrly-jobs` | — | `deploy/flavrly-jobs.cron` |

**Action (ops):** run `pm2 ls` on the VPS and record which ecosystem is live. `scripts/deploy-remote.sh` restarts `rm-web`. If the live processes are `flavrly-prod` and `flavrly-demo`, that script restarts nothing useful. Keep **one** definition (threat model T-23). The demo process must have `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` off and must have no PG cron; root `ecosystem.config.js` now sets it to `false` explicitly for `flavrly-demo` (applies after `pm2 startOrReload ecosystem.config.js --only flavrly-demo --update-env`).

## 1. Pre-deploy checklist

1. CI green on the exact commit: typecheck, lint, unit, **`test:db`**, **migration drift check**, build, gitleaks and CodeQL. Also read the npm-audit artifact.
2. `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` is **absent or false** in `apps/web/.env` on production. Check with `grep -c '^FLAVRLY_PG_NEW_PAYMENTS_ENABLED=true' .env`, which must print 0.
3. If the platform gateway config will be re-saved, set `FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY=true` in production `.env`. The documented base URL is `http://127.0.0.1:6100`, and the new SSRF validator rejects loopback without the flag. Never set `FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY` in production; the validator ignores it there anyway.
4. Take a fresh backup and verify it (§5): `pg_dump` for Flavrly, plus `VACUUM INTO` a copy of the gateway SQLite if the gateway changes too.
5. Write down the current deployed SHA as the rollback target: `git -C /opt/restaurant-manager rev-parse HEAD`.

## 2. Database migration order (expand → migrate → contract)

Current state, verified on a disposable local DB on 2026-10-24:
- `prisma migrate deploy` of the committed migrations on an empty DB succeeds.
- `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --exit-code` then exits **2**, because the migrations do not create 26 tables (all `Pg*`, `YoupiDailyUsage`, `YoupiFeatureRequest`, `DeliveryZone`, …), several enum variants and columns.
- Production has been changed with `prisma db push` (`deploy-remote.sh --migrate`), so production contains objects that no migration records.

Agent C's branch adds `20261024000000_catchup_db_push_drift` and `20261024000100_flavrly_pg_financial_layer`. Use these names as they appear after integration. Required order:

1. **Do not run `prisma db push` on production again.** Replace the `--migrate` branch of `scripts/deploy-remote.sh` with `npx prisma migrate deploy`. That script is Lead-owned, so this is a request.
2. **Baseline the catch-up migration on production without executing it**, and only after proving that the schema already matches:
   ```bash
   cd /opt/restaurant-manager/apps/web
   npx prisma migrate status                     # record output
   # Verify prod == state after catch-up migration (no SQL applied):
   npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
     --to-migrations prisma/migrations --shadow-database-url "$SHADOW_URL" --script > /tmp/prod-vs-migrations.sql
   ```
   - `$SHADOW_URL` is an empty scratch DB on the same server, never production.
   - If the only differences are the objects the PG migration (`…000100`) creates, mark the catch-up as applied: `npx prisma migrate resolve --applied 20261024000000_catchup_db_push_drift`.
   - If anything else differs, **stop**. Production has drift beyond the catch-up, and it needs a reviewed migration.
3. **Expand:** run `npx prisma migrate deploy`. This applies the additive PG financial layer: new tables, nullable columns on `PaymentWebhookEvent`, partial unique indexes, CHECK constraints and the append-only trigger.
   - The migration is additive, so old code keeps running against the new schema. That is what makes the code rollback in §4 safe.
   - Partial unique index creation on an existing table (`PaymentWebhookEvent`) takes a lock. It is small today, so measure first with `SELECT count(*)`.
4. **Deploy code** (§3). The new code reads the new tables. New checkout stays off by flag.
5. **Contract:** none in this release. Never drop the legacy `Payment.providerRef` lookups, `YoupiDailyUsage` or `PaymentWebhookEvent` columns in the same release. Any future contract migration ships in a separate release, after a full reconciliation cycle on the new code.

Restore drill before step 3 is mandatory (§5). Rehearse steps 2–3 on a restored copy of the production dump first, never on production first.

## 3. Deploy

The existing path: GitHub "Deploy to VPS" runs after green CI on `main`, SSHes in, does `git reset --hard origin/main` and runs `scripts/deploy-remote.sh`. With `migrate=true` on manual dispatch it runs `db push` today; replace that per §2.1. Manual equivalent on the VPS:

```bash
cd /opt/restaurant-manager && git fetch origin main && git checkout <reviewed-sha>
cd apps/web && npm install --no-audit --no-fund
npx prisma migrate deploy            # §2, only after the baseline step
npm run build && pm2 restart <rm-web|flavrly-prod> --update-env
curl -fsS http://127.0.0.1:3000/api/system/health
```

Then install or refresh the cron (§6), and confirm the jobs log shows `pg.worker.metrics` lines within 2 minutes.

### 3.1 GitHub deploy secrets (T-24)

`.github/workflows/deploy.yml` needs `VPS_SSH_KEY`, `VPS_USER`, `VPS_HOST` and, since pg/ops-r2, **`VPS_KNOWN_HOSTS`**.
The job **fails** in "Configure SSH" if `VPS_KNOWN_HOSTS` is missing, and SSH runs with `StrictHostKeyChecking=yes`
(no `ssh-keyscan` trust-on-first-use). **Owner action before the next merge to `main`:** add the secret, or the
automatic deploy stops at that step.

1. On the VPS console: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and note the fingerprint.
2. From your machine: `ssh-keyscan -t ed25519 <VPS_HOST> > vps_known_hosts`, then `ssh-keygen -lf vps_known_hosts`. The fingerprints must match.
   The host field must be the exact value of the `VPS_HOST` secret (IP or name).
3. `gh secret set VPS_KNOWN_HOSTS < vps_known_hosts` (one or more `known_hosts` lines).
4. Update the secret after any host key rotation on the VPS.

Workflow hardening in the same change: top-level `permissions: contents: read` in `deploy.yml` (and `ci.yml`), and
every action in `ci.yml` is pinned to a full commit SHA with a version comment (`deploy.yml` uses no actions).

## 4. Rollback

| What | How | Safe because |
|---|---|---|
| **Stop new PG checkouts (seconds)** | Set `FLAVRLY_PG_NEW_PAYMENTS_ENABLED=false` (or delete it) in `apps/web/.env`, then `pm2 restart <app> --update-env`. Next loads `.env` at start, so a restart is required. | `src/server/payments/index.ts:172-185` blocks only NEW provider selection. Webhook, status, sweep and `pg-worker` keep reconciling in-flight attempts. |
| **Stop one restaurant** | D7: set `PgReceivingAccount.disabledForNewAt=now()` or status `SUSPENDED` (merchant/platform UI, Agent F). Legacy: super-admin decision `DISABLE`. | `disabledForNewAt`/SUSPENDED blocks new sessions only. **Caution:** on the base branch the legacy DISABLE also stops reconciliation of that restaurant's in-flight payments (threat model T-05). Until A's fix is integrated, prefer the global flag plus manual review. |
| **Code rollback** | `git checkout <previous-sha>` in `/opt/restaurant-manager`, `npm install`, `npm run build`, pm2 restart. | The schema change is additive. Old code ignores the new tables. **Do not** roll back the migration. |
| **Schema rollback** | Not routine. Restore from the pre-deploy dump to a **new** database, verify it, then switch `DATABASE_URL` (§5). | It destroys financial records written after the backup. Owner approval is needed, plus reconciliation of the gap from bank statements. |
| **Gateway rollback** | Per `DEPLOY-pg-hardening.md`: `pm2 stop youpi-pg; git checkout pre-pg-hardening; cp data/backups/youpi_pg.sqlite.20261022-224404 data/youpi_pg.sqlite; rm -f data/youpi_pg.sqlite-wal data/youpi_pg.sqlite-shm; pm2 restart youpi-pg --update-env`. | Restores the 2026-10-22 state. Gateway sessions created after that backup are lost, so reconcile them from Flavrly attempts and bank statements. |

Never `git reset --hard` away unpushed work on the VPS, and never force-push.

## 5. Backups and restore drill

- `deploy/backup.sh` does `pg_dump -Fc | gzip`, keeps 7 daily and 4 weekly, and runs an optional `rclone` copy.
  - Encryption (T-22): with `BACKUP_AGE_RECIPIENT` (or `BACKUP_GPG_RECIPIENT`) set it also writes `rm-<date>.dump.gz.age` (`.gpg`) and rclone uploads **only** the encrypted files. With `RCLONE_REMOTE` set and no recipient it keeps the local dump, refuses the upload and exits 3, unless `BACKUP_ALLOW_PLAINTEXT_OFFHOST=1`. The private key is held offline by the owner.
  - `deploy/restore-drill.sh <throwaway_db> [--keep]` automates steps 1, 2, 4 (counts and the `PgAllocation` duplicate check) and 6 below; see OPERATIONS_RUNBOOK.md §5.
- Gateway SQLite: `sqlite3 data/youpi_pg.sqlite "VACUUM INTO 'data/backups/youpi_pg.$(date +%Y%m%d-%H%M%S).sqlite'"`, which gives a consistent copy while running.
- **Restore drill** (before every schema release, and at least quarterly; record the results in `~/flavrly-pg-evidence/<date>/restore-drill.md`):
  1. `createdb flavrly_restore_<date>` on a **non-production** server or port.
  2. `gunzip -c <dump>.gz | pg_restore --no-owner -d flavrly_restore_<date>`.
  3. `DATABASE_URL=<restore> npx prisma migrate status`, then `migrate deploy` (rehearse §2).
  4. Integrity counts: `Order`, `Payment` by status, `PaymentWebhookEvent`, and every `Pg*` table. `PgAllocation` must have no duplicate `bankTransactionId`. `PgFinancialEvent` sum by account must equal allocations.
  5. Point a local app at the restore and run `npm run test:db` (the schema is valid). Record durations: the RTO estimate is the restore time plus the migration time.
  6. Drop the restore DB.

## 6. Cron entries

Times are server-local (IST).
- Format: `/etc/cron.d/flavrly-jobs`.
- The secret comes from `.env` at run time and is never written into the file.
- Install with `sudo install -m 0644 deploy/flavrly-jobs.cron /etc/cron.d/flavrly-jobs`.
- `deploy/flavrly-jobs.cron` is not Agent G's file. The new line below is a request to the lead/B.

```cron
# Flavrly PG worker — webhook inbox, transactional outbox (ORDER_RELEASE etc.), gateway-status sweep.
# Each stage runs under its own PgJobLease, so overlap with the legacy youpi-reconcile line is safe.
* * * * * deploy . /opt/restaurant-manager/apps/web/.env; curl -fsS -m 55 -X POST -H "x-internal-secret: $INTERNAL_CRON_SECRET" https://flavrly.in/api/platform/jobs/pg-worker/run >> /var/log/restaurant-manager/jobs.log 2>&1
```

- Keep the existing `*/3 … youpi-reconcile/run` line until B confirms `pg-worker` covers the sweep. It shares the `youpi-reconcile-sweep` lease, so running both is safe.
- Use POST only (threat model T-17).
- Alert when the log shows no `pg.worker.metrics` line for 5 minutes (OPERATIONS_RUNBOOK.md §2).

## 7. Conditions to set `FLAVRLY_PG_NEW_PAYMENTS_ENABLED=true`

All of the following are required. Each one needs evidence, not a claim:
- Every COMPLIANCE gate is not BLOCKED.
- Threat-model Critical and High items are closed or isolated by a control.
- Drift check green.
- Restore drill done.
- Staging UAT done.
- Device APK hash verified.
- Owner's written go/no-go.

Until then, the flag stays unset in production.
