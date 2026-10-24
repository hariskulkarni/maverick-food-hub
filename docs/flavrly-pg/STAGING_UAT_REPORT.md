# Flavrly PG — local synthetic UAT report (Agent S, 2026-10-24)

> **This is a local synthetic UAT on one developer machine. It is not an authorized staging deployment,
> and it is not real-money testing.** No real money, bank, bank feed, phone number, VPA or production host
> was involved. 148.230.66.124 and `*.flavrly.in` were never contacted. Every payment was a synthetic bank
> alert pushed through the fork's Developer Test Mode simulator. Every bank credit was a hand-written CSV
> statement. The receiving VPA is `uat-restaurant@upi-fake`. Customer phones are `+9100000001xx`, which are
> not valid Indian mobiles. Gateway payer mobiles use the fork's fictitious `9000000xxx` range. Secrets were
> generated for this run only and kept in a session scratch directory (mode 600, outside git). They are
> redacted from all evidence, and a scan found 0 leaked values out of 18 checked.

## Environment

| Item | Value |
|---|---|
| App | branch `pg/s-uat` = `pg/lead`. **Pass 1** ran at `591d036`. **Pass 2** is authoritative and ran at the tip `5d321f0` (includes A/C/E/H fixes after the 34a5ba5 gate). Built with `npm run build`, run with `next start -H 127.0.0.1 -p 3311`, `NODE_ENV=production` |
| App runtime | Node v20.20.2, Next 15.5.18, Prisma 5.22.0, Postgres 16.15 `postgresql://ci@localhost:55432/ci_uat` (`prisma migrate deploy`, 17 migrations, never `db push`), seed `prisma/seed.ts` |
| App flags | `FLAVRLY_PG_NEW_PAYMENTS_ENABLED=true` (local only), `FLAVRLY_PG_CHECKOUT_ORIGIN=https://localhost:7712`, `FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY=true`, `OTP_DEMO_MODE=true`, `NOTIFIER_SMS=mock`, no Redis |
| Gateway | fork `flavrly/pg-hardening` @ `7720b49`, detached worktree `flavrly-pg/wt-s-uat` (the deployed checkout `repo/` was not touched, and its `data/.secrets` was not read). Node v24.22.1, payment-api :6611, checkout portal :7711, own SQLite file, throwaway `ADMIN_API_TOKEN` and other secrets via env |
| Gateway mode | `NODE_ENV=development` / `FLAVRLY_MODE=localhost`, because the fork refuses dev tools (simulator) and private webhook URLs under production. `FLAVRLY_ALLOW_PRIVATE_WEBHOOKS=true`, `PAISE_OFFSET_ENABLED=true` |
| HTTPS | Production app code requires an https checkout origin. A local self-signed TLS proxy at `https://localhost:7712` fronts the checkout portal, so the app ran with production semantics and the receiver-readback plus checkout-origin check was live |
| Webhook | A fork Standard Webhooks endpoint (`legacyFormat=false`, envelope with `paidAmountPaise`) points to the webhook tap `:3312`, which records raw requests and forwards to the app's `/api/payments/youpi/webhook`. The merchant legacy webhook URL was cleared, so no legacy flat-body endpoint existed |
| Credentials | `IntegrationCredential(restaurant, YOUPI)` was written with the app's own `saveConfig()`/`encryptJSON()` (`scripts/pg-uat/setup-fixtures.ts`): `merchantKey` = fork merchant webhook secret (FORK ownership proof), `webhookSecret` = endpoint `whsec_…` |
| Synthetic payment | Fork Developer Test Mode: `POST /api/v1/admin/dev/test-mode {enabled:true}`, then `POST /api/v1/admin/dev/simulator/inject` (SMS `HDFCBK`, "A/C XX9999 credited with Rs <payable> CR. Ref <12-digit UTR> (SYNTHETIC UAT)"). Before this, the gateway payer registers (`/customer/register`), binds (`/checkout/:id/bind-customer`, which makes the session ACTIVE and allocates the paise offset) and taps `/payment-done` |
| Logins | Through the real NextAuth flows. Staff use email + password + TOTP (TOTP secrets enrolled via the app's encryption). Customers use phone-OTP demo `devCode` |

Evidence: `/Users/bunny../flavrly-pg-evidence/2026-10-24/agent-s/`
`pass2-5d321f0/` is authoritative and `pass1-591d036/` is the first pass. Each `sNN-*/` folder holds `run.log` (every HTTP call with its code and redacted body, plus EXPECT lines), `db*.txt` (row snapshots) and `ids.json`. Raw process logs are in `logs/`.
Re-run: `UAT_DIR=<secret dir> EVID=<dir> scripts/pg-uat/run-all.sh`. Then run `s03b-stale-replay.mjs` 5 minutes or more later, and `s06b-expiry.mjs` 46 minutes or more later.

## Results (pass 2 @ 5d321f0; pass 1 @ 591d036 gave the same outcomes)

| # | Scenario | Result | Key evidence (`pass2-5d321f0/…`) |
|---|---|---|---|
| 0 | Onboarding: request → APPROVE; receiving account VERIFIED, creator self-verify refused (409 SAME_PERSON), second super admin verifies | PASS (with DEFECT-1 workaround) | `s00-onboarding/` |
| 1 | Happy path: AWAITING_PAYMENT, https checkout URL (200 via TLS proxy) → payment observed at gateway → signed webhook → OBSERVED + UTR + payable → still PAYMENT_PENDING, absent from `/api/kitchen/orders` → CSV import (payable amount, UTR) → pg-worker → Payment CAPTURED, 1 ORDER_PAYMENT allocation, outbox DONE, order RECEIVED, visible in kitchen. Re-imports: same file is `duplicateFile`, overlapping file gives 1 duplicate row and 1 new UNMATCHED credit, no new allocation | PASS | `s01-happy-path/run.log`, `db-1/2/3*.txt` |
| 2 | Webhook paid, no bank credit: stays OBSERVED / PAYMENT_PENDING, Payment PENDING, 0 allocations, not in kitchen. Fork paise offset exercised (payable 8301 vs expected 8300). After really waiting past expiresAt + 30 min, the expiry stage did **not** expire it. Pass 1 flagged it STALE_PENDING. In pass 2 there was no flag, which is intended: OBSERVED is flagged only after 48 h at 5d321f0 (see O-3) | PASS | `s02-paid-no-bank-credit/` |
| 3 | Duplicates and replays: fork resend and endpoint replay (same webhook-id) both got 200 deduped. A byte-identical captured replay got 200 deduped. A stale replay (signed 1298 s earlier) of a known id got 200 deduped. A forged webhook-id or tampered body got 401. Webhook rows and evidence counts did not change | PASS | `s03-duplicate-and-replay/run.log`, `logs/tap-proxy.log` |
| 4 | Gateway SIGKILL during the first delivery. A: request in flight, never reached the app; after restart the same webhook-id was redelivered about 20 s later and processed once. B: app had committed but the gateway died before seeing the 200; redelivered and the app answered 200 deduped. Each case: 1 webhook row, 1 GATEWAY_WEBHOOK evidence | PASS | `s04-gateway-sigkill/`, `logs/tap-proxy.log` |
| 5 | App SIGKILL right after the statement-import allocation commit (CAPTURED + outbox PENDING + order PAYMENT_PENDING). After restart, 3 worker ticks: outbox DONE (attempts 1), order RECEIVED, exactly one RECEIVED status event, visible in kitchen | PASS | `s05-app-sigkill-after-allocation/` |
| 6 | Never-paid session: a retry while AWAITING reuses the same attempt. After real expiry + 30 min grace the worker sets attempt EXPIRED, Payment FAILED, order PAYMENT_FAILED; only then does retry open a NEW attempt | PASS (both passes; real wall-clock wait, no clock manipulation) | `s06-never-paid-expiry/` |
| 7 | `DISABLE_NEW` (disabledForNewAt): checkout page stops offering PG; a new PG order is refused (no order, no attempt). The in-flight attempt still gets its webhook → OBSERVED → CSV → CAPTURED → RECEIVED. `ENABLE_NEW` restored the account afterwards | PASS (see O-1) | `s07-disabled-merchant/` |
| 8 | Refund: restaurant cancels; WALLET refused 409; platform requests MANUAL_BANK; COMPLETE before approval refused 409; approved by a different user; completed with fake ref `UATREFUND0001` → Refund COMPLETED, Payment REFUNDED, order REFUNDED, attempt REFUNDED | PASS | `s08-refund/db.txt` |
| 9 | Backup drill: `pg_dump -Fc` → restore into a new DB → `migrate status`/`deploy` (no pending migrations, 0 drift vs schema.prisma) → row counts equal across 121 tables. Integrity checks: no duplicate allocations, allocations = allocated credits = PAYMENT_CAPTURED events; append-only trigger present; restore DB dropped; restore + migrate 5 s. Flag off (app restarted with `FLAVRLY_PG_NEW_PAYMENTS_ENABLED=false`): PG hidden at checkout, new PG order refused; an attempt opened before the switch still went webhook → OBSERVED → CSV → worker → CAPTURED/RECEIVED. Flag restored afterwards | PASS | `s09-rollback-and-flag/backup-drill.log`, `run.log` |

Scenario 9 limit: the source DB was already fully migrated, so "apply migrations to the restored copy" was a no-op. A roll-forward from a pre-PG schema dump was not rehearsed here.

## Defects and observations (no application source was changed)

- **DEFECT-1 (blocks first-time setup on a fresh DB; present at 591d036 and 5d321f0).** `POST /api/platform/youpi/config` returns 500 with Prisma P2003 `IntegrationCredential_restaurantId_fkey`. The route saves under the sentinel `restaurantId='__platform__'` (`src/app/api/platform/youpi/config/route.ts:75`), but only `ensurePlatformRestaurant()` in `src/server/2fa.ts:46` creates that sentinel Restaurant row, and it runs only when platform security is saved. Because `decision/route.ts:50` refuses APPROVE without the platform config, a new environment cannot approve any restaurant.
  - Repro: fresh DB + seed, then as SUPER_ADMIN `POST /api/platform/youpi/config {baseUrl, merchantId, webhookSecret}` returns 500.
  - Workaround used here: `PATCH /api/platform/security {"lockoutMinutes":15}`, which is the default value and changes no behaviour.
  - Production is probably unaffected if the row already exists. Verify with `select id from "Restaurant" where id='__platform__'`.
  - Suggested fix: export `ensurePlatformRestaurant` and call it before `saveConfig(PLATFORM_ID, …)`.
- **O-1 (API quality, not money-affecting).** When a new Flavrly PG order is refused (account disabled or flag off), `placeOrder` throws a plain `Error` (`src/server/orders.ts:135`) and the route maps every error to HTTP 500 `{"error":"Failed to place order"}` (`src/app/api/orders/route.ts:81`). The refusal itself is correct, but clients and alerting see a server error. A 4xx with a reason code would be better.
- **O-3 (alerting gap, 5d321f0).** OBSERVED attempts are flagged STALE_PENDING after `OBSERVED_STALE_MS` = 48 h, measured on `updatedAt` (`src/server/pg/attempts.ts:480`, `:536`). Every sweep probe writes `lastStatusAt` (`src/server/payments/youpi-reconcile.ts:84`), which bumps `updatedAt`. In pass 2 the S2 attempt had updatedAt = lastStatusAt = the time of the tick. So while the gateway is reachable, an OBSERVED attempt with no bank credit may never raise the stale alert (runbook signal #9/#11). Suggested fix: measure from the OBSERVED transition time or `createdAt`.
- **O-2 (not a defect).** The fork's delivery `attemptCount` does not count an attempt killed by SIGKILL. Redelivery is proven by the tap log, which shows the same `webhook-id` sent twice.
- Not covered by HTTP: the requester ≠ approver refusal for refunds. The only request route is platform (SUPER_ADMIN) and approval is restaurant-ADMIN, so the same person cannot do both through the API. That rule is covered by DB tests only.

## Helper scripts (`scripts/pg-uat/`)
`env.sh`, `start-gateway.sh`, `start-app.sh`, `tls-proxy.mjs`, `tap-proxy.mjs`, `gw-setup.mjs`, `setup-fixtures.ts`, `uat-lib.mjs`, `flow.mjs`, `s00…s09*`, `run-all.sh`. None contains secrets. They read them from `$UAT_DIR`.

## Lead resolution (after this report)
Fixed in `9236900` on `pg/lead`, full gate green at `2036bf5` (1545 unit, 172 real-DB, build):
- DEFECT-1: `ensurePlatformRestaurant` is exported and called by `POST /api/platform/youpi/config` before `saveConfig`.
  Tests: `youpi-admin-routes.test.ts` (sentinel created before save), `tests/db/lead-uat-fixes.test.ts` (real FK).
- O-1: `placeOrder` throws `PgUnavailableError`; `/api/orders` returns 409 with the reason. Other failures stay 500.
  Test: `__tests__/server/orders-route-pg-refusal.test.ts`. The checkout client treats any non-OK status the same way.
- O-3: the OBSERVED (48 h) and REVIEW_REQUIRED stale alerts are measured from `createdAt`, not `updatedAt`.
  Test: `tests/db/lead-uat-fixes.test.ts` (old attempt with fresh updatedAt is flagged).
The UAT scenarios were not re-run after these fixes; they touch setup, an error status code and alert timing only.
