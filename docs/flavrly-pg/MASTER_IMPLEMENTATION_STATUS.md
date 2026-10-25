# Flavrly PG — Master implementation status

**Verdict: ENGINEERING COMPLETE (pilot scope) / PRODUCTION BLOCKED** — see [FINAL_GO_NO_GO.md](FINAL_GO_NO_GO.md).

Integration branch: `pg/lead` (pushed as `pg/integration-20261024`, then to PR #29 head). Base: PR #29 head `eebd11f`.
Contract: [ARCHITECTURE_AND_DATA_FLOWS.md](ARCHITECTURE_AND_DATA_FLOWS.md). Evidence: [TEST_EVIDENCE.md](TEST_EVIDENCE.md),
lead machine `~/flavrly-pg-evidence/2026-10-24/` (gate logs, per-agent logs, #86 SIGKILL repro, APK build).

## Phase 0 baseline (PR #29 head `eebd11f`)
generate/validate/db push/typecheck/lint/responsive OK; 137 files / 1304 unit tests; build OK; GitHub CI green.
No real-database tests existed; the PR author had not run any tests (SAFE_PILOT_HARDENING.md).

## Final gate (`pg/lead` @ `b3d489c`, round 2)
migrate deploy from empty OK, drift 0, typecheck/lint/responsive OK, **1566 unit tests**, **202 real-Postgres tests**. Production build green in GitHub CI (run 40149598277, all 5 checks pass).

Round 2 (2026-10-24 evening): independent production-readiness audit found 4 P0 / 10 P1 / 9 P2 defects around the capture core (retry after expiry booked as LATE, post-commit refusals stranding orders, lost-webhook paise offset unallocatable, gateway FAILED not failing the order, missing ops refund/void/reversal/requeue paths, stale releases). All fixed on `pg/money-r2` with red-before-green tests (`tests/db/r2-money.test.ts`, `tests/db/r2-ops.test.ts`). Also merged: `pg/ops-r2` (T-16/17/22/23/24) and `pg/deps-r2` (T-20).
Local synthetic UAT: 9/9 PASS (STAGING_UAT_REPORT.md).

## Findings matrix (prior audit P0/P1 → fresh verification → status)

| # | Finding (prior audit) | Fresh evidence at `eebd11f` | Status now | Where |
|---|---|---|---|---|
| P0-1 | Missing UTR in gateway status | Confirmed: status view has no UTR (UPSTREAM_CONTRACT.md); reconcile required it → nothing could ever capture | FIXED: UTR comes from HMAC-verified webhook as evidence; capture needs a bank credit | `pg/inbox.ts`, `pg/reconcile-engine.ts` |
| P0-2 | Restaurant VPA ≠ upstream merchant's bank account | Confirmed: gateway pays the merchant's single active VPA; Flavrly VPA was a label | FIXED/MITIGATED: VERIFIED `PgReceivingAccount` binding, unique per gateway merchant, readback must match before checkout; one restaurant per gateway merchant until upstream #89 | `pg/merchant-binding.ts`, `pg/attempts.ts`, `pg/receiving-accounts.ts` |
| P0-3 | Auth mismatch on create | Confirmed: upstream requires X-Merchant-Key (PR #78); fork does not check | FIXED: server-side key, `redirect:'error'`, masked | `payments/youpi-api.ts` |
| P0-4 | Orders to kitchen before payment | Partly fixed on PR #29 (PAYMENT_PENDING) but admin could release manually, KOT printable | FIXED: release only via outbox after allocation; manual release blocked; KOT refuses | `orders.ts`, `pg/fulfillment.ts`, KOT route |
| P0-5 | Non-atomic duplicate capture | Confirmed (`findFirst` + `updateMany`) | FIXED: row locks + partial unique indexes; 20-way concurrency test | migration `…000100`, `tests/db/reconcile-engine.test.ts` |
| P0-6 | Observer success treated as settlement | Confirmed: status SUCCESS + UTR captured | FIXED: SUCCESS = OBSERVED only | `youpi-api.ts` mapStatus |
| P0-7 | Cross-tenant attribution | Confirmed: global webhook lookup, platform secret | FIXED: per-merchant secrets, attempt-scoped lookup, tenant tests | `pg/webhook-auth.ts`, `tests/db/h-tenant.test.ts` |
| P1-1 | Retry identity collisions | Confirmed (`count+1`) | FIXED: cuid attempt keys, CREATE_UNKNOWN blocks | `pg/attempts.ts` |
| P1-2 | Lost webhooks | Upstream #86 reproduced by SIGKILL; fork mostly durable, 2 gaps | Flavrly side FIXED (durable inbox, sweep, expiry); fork patch local only (licence) | `pg/inbox.ts`, evidence `agent-b/b86/` |
| P1-3 | Replay/idempotency | Confirmed (body-only HMAC) | FIXED: timestamp-bound signatures, dedupe | webhook route |
| P1-4 | Worker locking | Confirmed (pooled advisory lock) | FIXED: `PgJobLease` + row leases | `pg/job-lease.ts` |
| P1-5 | Stale pending | Confirmed (never expired) | FIXED: expiry stage, STALE_PENDING exceptions | `expireStaleAttempts` |
| P1-6 | Limits per restaurant | Confirmed | FIXED: per receiving account + per customer, released only when provably unpaid | `pg/limits.ts` |
| P1-7 | Refund inconsistencies | Confirmed (fake COMPLETED in dev) | FIXED: two-person manual bank refund with human-entered bank reference | `pg/refunds.ts` |
| P1-8 | Payment-mode/settlement gaps | Confirmed (PSP fee on direct UPI; unpaid in GMV) | FIXED: DIRECT_TO_MERCHANT settlement, unpaid excluded from GMV | `settlement.ts`, reports, analytics |
| P1-9 | Schema migration drift | Confirmed: 26 tables missing from migrations | FIXED in code: idempotent catch-up + Pg migration, CI drift check; prod baselining is an owner step | `prisma/migrations`, DATABASE_MIGRATIONS.md |
| P1-10 | No financial ops visibility | Confirmed | FIXED: merchant + platform ops pages, exception queue, worker metrics | `app/admin/flavrly-pg`, `app/platform/youpi/ops` |
| new | Fork 0–99 paise payable offset | Found by Agent A | FIXED: signed `payableAmountPaise`, exact match, DB CHECK | BANK_RECONCILIATION_SPEC.md addendum |

## Task board

| Agent | Scope | Branch (final) | Integrated | Notes |
|---|---|---|---|---|
| Lead | contract, schema v1, integration, cross-cutting fixes, docs | `pg/lead` | — | ~20 lead commits (pay-route scope, KOT, middleware, cron, retention, offset, sweep fairness) |
| A | binding, attempts, limits, gateway client, expiry | `pg/a-core` | yes (2 rounds) | UPSTREAM_CONTRACT.md |
| B | webhook route, inbox/outbox, leases, worker, #86 | `pg/b-webhooks` | yes | fork patch on `flavrly/b86-verify` (local) |
| C | migrations, ledger, ingest, engine | `pg/c-ledger` | yes (2 rounds) | FINANCIAL_INVARIANTS, BANK_RECONCILIATION_SPEC, DATABASE_MIGRATIONS |
| D | fulfillment, status UX, kitchen audit | `pg/d-checkout` | yes | |
| E | refunds, settlement, reports | `pg/e-refunds` | yes (2 rounds) | REFUNDS_AND_SETTLEMENTS |
| F | onboarding, merchant/ops UI, CRM check | `pg/f-merchant` | yes | CRM: loyalty fires only on DELIVERED (`orders.ts`), once-only proven in `tests/db/f-merchant.test.ts` |
| G | security, CI, upstream matrix, APK, compliance, ops docs | `pg/g-security` | yes | |
| H | independent QA | `pg/h-qa` | yes | 10 defects found, all fixed |
| S | local synthetic UAT | `pg/s-uat` | yes | 9/9 scenarios PASS; 1 defect + 2 observations, all fixed by lead (`9236900`) |

## Deliberate decisions (recorded)
- FIRST_ORDER offers still count PAYMENT_PENDING orders: excluding them would let one customer stack first-order discounts across several unpaid orders and then pay all.
- Merchant ADMIN statement upload counts as bank evidence for its own account (audited, single-person); see threat model addendum.
- Session caps: 15 open per receiving account (below the 20/day pilot cap), 3 per customer; platform-config overridable.
- `next`/`next-auth` security upgrades kept out of this PR (separate regression-tested change).
