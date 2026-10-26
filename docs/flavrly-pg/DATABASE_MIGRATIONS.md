# Flavrly PG — database migrations

Owner: Agent C (`apps/web/prisma/**`). Evidence logs: `~/flavrly-pg-evidence/2026-10-24/agent-c/`.
Paths below are relative to `apps/web/`.

## 1. What was wrong (drift)

Production schema changes were applied with `prisma db push` (`scripts/fix-prod.sh:104-105`,
`scripts/deploy-remote.sh:68-69`) without committed migrations. Comparing the 14 committed
migrations to `schema.prisma` at `eebd11f` (pre-PG) with

```
prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel <schema.prisma @ eebd11f> \
  --shadow-database-url postgresql://ci@localhost:55432/ci_c_shadow --script
```

showed the following objects missing from migrations:

- enums `AddressLabel`, `DeliveryZoneType`, `ModerationStatus`, `ReviewReplyState`,
  `ReviewReplySource`, `YoupiRequestStatus`; `IntegrationProvider` values
  `META_WHATSAPP`, `GOOGLE_BUSINESS`, `LLM_REVIEWS`, `YOUPI`
- tables `PasswordResetToken`, `DeliveryZone`, `WebPushSubscription`, `RiderArrival`,
  `ObsErrorLog`, `ObsProbe`, `ObsProbeEvent`, `SiteContent`, `GoogleReview`, `ReviewReply`,
  `ReviewAutoReplyConfig`, `YoupiDailyUsage`, `YoupiFeatureRequest` (+ their indexes and FKs)
- columns on `Address`, `Order.feedbackRequestedAt`, `OrderFeedback` (moderation/reply),
  `Reservation.depositProviderOrderId`, `Restaurant.autoPublishReviews/deletedAt`,
  `RiderPreferences`, `TrainingModule`, `User` (TOTP); `Offer.fulfillmentScope` default dropped.

## 2. Migrations added

| Migration | Purpose |
|---|---|
| `prisma/migrations/20261024000000_catchup_db_push_drift/migration.sql` | The drift above, rewritten to be **idempotent**: `DO $$ CREATE TYPE ... EXCEPTION WHEN duplicate_object $$`, `ADD VALUE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, FKs in `DO $$ ... duplicate_object $$`. No DROP, no data rewrite. |
| `prisma/migrations/20261024000100_flavrly_pg_financial_layer/migration.sql` | Generated part: 13 `Pg*` tables + enums, nullable/defaulted lease columns on `PaymentWebhookEvent`. Raw-SQL part (lines 421-466): partial unique indexes, CHECKs, append-only trigger. Purely additive; NOT idempotent (new objects). |

Raw-SQL invariants in the Pg migration (Prisma cannot express them, and `migrate diff`
does not report them as drift — verified below):

- `PgAllocation_one_live_order_payment_per_order` / `_per_attempt` (lines 425-431):
  unique `orderId` / `attemptId` WHERE `kind='ORDER_PAYMENT' AND "reversedAt" IS NULL`.
- `PgReceivingAccount_verified_gatewayMerchantId` / `_verified_restaurantId` (lines 435-441):
  unique WHERE `status='VERIFIED'`.
- CHECK `> 0` on every money-movement amount (lines 444-450), `reserved >= 0` (451), and
  `PgBankTransaction_bankReference_normalized` (non-empty, upper-case, no whitespace).
- Trigger `PgFinancialEvent_append_only` (lines 456-466): any UPDATE/DELETE raises.

## 3. Proof

`agent-c/01-catchup-idempotency.log` — on DB `ci_c_pushed`:
1. `migrate deploy` of the 14 pre-existing migrations (simulated prod history) — exit 0;
2. `db push` of the pre-PG schema (simulated `fix-prod.sh`) — creates all drift objects;
3. `migrate status` lists only `20261024000000_catchup_db_push_drift` as pending;
4. `migrate deploy` applies it on top of the db-pushed objects — exit 0 (first application);
5. `prisma db execute --file .../20261024000000_catchup_db_push_drift/migration.sql` — exit 0
   (second application of the same SQL);
6. `migrate diff --from-schema-datasource ... --to-schema-datamodel <pre-PG schema> --exit-code` — "No difference detected", exit 0.

`agent-c/02-pg-migration-deploy-diff.log` — on empty DB `ci_c_empty`:
- `migrate deploy` applies all 16 migrations — exit 0;
- `migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code` — exit 0;
- `migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url ... --exit-code` — exit 0;
- psql lists the 4 partial unique indexes, 9 CHECK constraints and the trigger;
- the same `migrate deploy` on `ci_c_pushed` (history + db push + catch-up) also applies the Pg migration, diff exit 0.

`npm run test:db` resets a `ci*` DB with `prisma migrate reset` (i.e. replays every migration)
before each run, so every DB test run re-proves that the migration chain builds the schema.

## 4. Applying in production

Run on a **restored copy** of production first (master prompt §21), then production:

```
cd apps/web
npx prisma migrate status            # expect: the two 20261024* migrations pending
npx prisma migrate deploy
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma --exit-code   # expect exit 0
```

- **Database that already has the drift objects from `db push`:** nothing special.
  `migrate resolve --applied` is NOT needed for `20261024000000_catchup_db_push_drift`,
  because every statement is guarded and the SQL was proven to apply twice on a
  db-pushed database (section 3, steps 4-5).
- **Database whose `_prisma_migrations` table is missing or does not list the older 14
  migrations** (i.e. it was only ever `db push`ed): `migrate deploy` stops with P3005/P3018
  because those older migrations are not idempotent. Check `migrate status` first. If so,
  baseline the older ones once — `npx prisma migrate resolve --applied <name>` for each of the
  14 migrations from `0_init` through `20261019_order_feedback_share_publicly` — after
  confirming with `migrate diff --from-schema-datasource ... --to-schema-datamodel
  <schema @ eebd11f>` that the live DB already matches them. Then `migrate deploy`.
  This was NOT verified against production (no access, by design); the production
  `_prisma_migrations` state is unknown to this agent.
- **Do not `prisma db push` the new schema to production.** `db push` would create the Pg
  tables WITHOUT the raw-SQL indexes/CHECKs/trigger, and the Pg migration (not idempotent)
  would then fail. `scripts/deploy-remote.sh --migrate` and `scripts/fix-prod.sh` still use
  `db push` — request to owner of those scripts (lead/G) to switch to `migrate deploy`.
- `.github/workflows/ci.yml:56` uses `prisma db push`; DB-level invariants therefore exist
  only in `npm run test:db` databases, not in that CI job. Request to G: run
  `prisma migrate deploy` there (and add `npm run test:db`).

Locking: the catch-up migration adds nullable/defaulted columns (metadata-only in PG 11+),
creates new tables and indexes on new or small tables. `ADD COLUMN ... NOT NULL DEFAULT` on
`OrderFeedback`, `Restaurant`, `TrainingModule` is metadata-only for constant defaults in
PG 11+. The Pg migration only touches `PaymentWebhookEvent` with defaulted columns.

## 5. Recovery

Both migrations are additive. Rollback = deploy the previous app build; the new tables and
columns are ignored by old code. Never drop `Pg*` tables holding data (financial records).
If the Pg migration fails mid-way, Prisma marks it failed: fix the cause, then
`prisma migrate resolve --rolled-back 20261024000100_flavrly_pg_financial_layer` after
manually dropping the partially created `Pg*` objects on a DB that holds no Pg data yet.

## 6. Real-DB test harness

- `vitest.db.config.ts`: includes `tests/db/**/*.test.ts`, `pool: 'forks'`, `maxWorkers: 1`,
  `fileParallelism: false`. The default `vitest.config.ts` includes only
  `tests/unit`, `tests/integration`, `__tests__`, so `tests/db` stays excluded.
- `tests/db/global-setup.ts`: refuses unless `DATABASE_URL` host is localhost and the DB name
  starts with `ci` (`assertDisposableDbUrl`, tested in `tests/db/harness-guard.test.ts`),
  then runs `prisma migrate reset --force --skip-seed --skip-generate`.
- Run: `DATABASE_URL=postgresql://ci@localhost:55432/ci_c?schema=public npm run test:db`.
