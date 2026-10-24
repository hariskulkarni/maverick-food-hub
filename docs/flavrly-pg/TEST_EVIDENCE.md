# Flavrly PG — test evidence (DRAFT, Agent H independent QA; lead finalizes)

Date: 2026-10-24. Code under test: `pg/lead` @ `34a5ba5` (fast-forwarded into `pg/h-qa`; includes
Agents A, B, C, D, E, G). Agent F (merchant/platform PG admin routes and UI) is **not** merged.

Evidence here is what Agent H re-ran. Earlier reports from other agents were not used as evidence.

## 1. How the tests run

- Real Postgres 16, disposable DB `ci_h` (`postgresql://ci@localhost:55432/ci_h`), `prisma migrate reset`
  per run (`tests/db/global-setup.ts`). The database is never mocked.
- Stubbed: global `fetch` for the gateway only (`tests/db/h-support.ts:gatewayFetch` serves create,
  private readback, lookup by attemptKey, status), and notifications/realtime/push side effects.
  Session (`auth()`) and `next/headers` cookies are stubbed in the route-level tenant tests.
- Webhooks are signed with real HMAC-SHA256 in both accepted schemes (`X-Gateway-Signature-V2`,
  Standard Webhooks) and POSTed into the real route handler.
- Faults are injected by leaving rows exactly as a killed worker leaves them (lease held, expiry passed),
  or by making one Prisma call reject (DB unavailable / transaction start timeout).

## 2. Agent H test files (`apps/web/tests/db/`)

| File | Tests | What it proves |
|---|---|---|
| `h-full-chain.test.ts` | 2 | `createPgAttempt` (real binding, limits, gateway create + readback) -> signed webhook POST -> inbox -> evidence -> status probe -> CSV import -> `allocateBankCredit` -> outbox -> `handleOrderRelease` -> order RECEIVED. Every table asserted (Payment, PgPaymentAttempt, PgPaymentEvidence, PgBankTransaction, PgStatementImport, PgAllocation, PgFinancialEvent, PgOutbox, Order, OrderStatusEvent). All replays (webhook, inbox, file, outbox, sweep) leave the snapshot unchanged. |
| `h-adversarial.test.ts` | 32 | Forged signature, other tenant's secret, platform secret, body tampering, body-only legacy signature, timestamp re-stamping, replay, stale/future timestamp, header/body mismatch, 64 KiB cap, missing secret -> 503, identity confusion across tenants; SUCCESS without credit never captures; 1-paisa mismatches; credit in another tenant's account; same UTR on two attempts; missing UTR; overcollection; late payment after cancel and after gateway FAILED; DEBIT row; out-of-window credit; forged outbox row; manual transition guard; duplicate/overlapping/conflicting statements; manual entry and manual allocation dual control. |
| `h-faults.test.ts` | 13 | Crash after allocation commit (outbox lease expiry -> released once), crash after transitionOrder before DONE, inbox crash reclaim, handler failure backoff -> DEAD + exception, webhook dead-letter, DB failures in the webhook route -> 503; import and allocation failure modes; liveness gaps. |
| `h-concurrency.test.ts` | 8 | Webhook vs 2 sweeps vs 2 inbox workers on one attempt; 20 independent parallel allocations; 20 parallel allocations of one credit; 20 attempts on one order; same file x5 in parallel; 5 overlapping files; 5 concurrent approvers; mixed overlapping workers. |
| `h-attempts-refunds.test.ts` | 8 | 10 parallel session starts for one order; CREATE_UNKNOWN blocks a second session until resolved; lost-response resolution; per-account pending cap under parallel starts; 5 parallel refunds; refund after reversal; refund reference reuse; worker expiry-stage liveness. |
| `h-tenant.test.ts` | 7 | Every PG route present (`payments/youpi/status`, `admin/youpi/{vpa,request}`, `platform/youpi/*`, `platform/jobs/{pg-worker,youpi-reconcile}/run`, PG guards on `orders/[id]/pay` and `admin/orders/[id]/kot`) refuses cross-tenant / wrong-role access. |
| `h-retry-guard.test.ts` | 3 | Server refuses a second session while an attempt is OBSERVED or CREATE_UNKNOWN; status page retry offer. |
| total | **73** | **63 pass, 10 fail. Every failure is a reported defect (section 4); none is a harness problem.** |

## 3. Commands and results (Agent H, `pg/h-qa` = `pg/lead` @ 34a5ba5 + H tests)

| Command (from `apps/web`) | Exit | Result |
|---|---|---|
| `DATABASE_URL=...ci_h npm run test:db` | 1 | 16 files, 151 tests: 141 pass, 10 fail (all 10 are the H defect tests below; all non-H DB tests pass) |
| `npm run test:ci` | 0 | 150 files, 1519 tests pass (includes PhonePe, Razorpay, refunds, wallet, verify-route, youpi suites) |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | warnings only (pre-existing `no-explicit-any`) |
| Playwright e2e | not run | see section 5 |

## 4. Failing tests = open defects (leave failing until fixed)

| ID | Sev | Test | Code |
|---|---|---|---|
| H-10 | High | `h-attempts-refunds` "CREATE_UNKNOWN attempts still get resolved when many OBSERVED attempts await the bank statement" | `pg/attempts.ts:493-509` |
| H-02 | High | `h-faults` "a DB error mid-import does not make the rest of the statement un-importable" | `pg/bank-ingest.ts:154-203` |
| H-02b | High | `h-faults` "a transient failure allocating one credit does not strand the other credits of the same file" | `pg/bank-ingest.ts:129-131` |
| H-06 | Medium | `h-retry-guard` "status page does not offer retry when a bank credit was already allocated" | `pg/customer-status.ts:57`, `pg/attempts.ts:160-182` |
| H-08 | Medium | `h-attempts-refunds` "a refund cannot be completed after the underlying bank credit was reversed" | `pg/refunds.ts:403-430` |
| H-09 | Medium | `h-attempts-refunds` "the original payment's UTR is not accepted as the refund bank reference" | `pg/refunds.ts:421-424` |
| H-03 | Medium | `h-adversarial` "a bank credit with no candidate attempt raises an UNMATCHED_CREDIT exception" | `pg/bank-ingest.ts:129-131`, `pg/reconcile-engine.ts:409` |
| H-04 | Medium | `h-faults` "credit first, then signed webhook UTR while the status API is down" | `pg/inbox.ts:80-98`, `payments/youpi-reconcile.ts:87-100` |
| H-01 | Low | `h-faults` "allocation against a live attempt whose Payment is FAILED opens an exception" | `pg/reconcile-engine.ts:340` |
| H-05 | Low | `h-faults` "sweep is not starved by 100 older long-pending payments" | `jobs/youpi-reconcile-sweep.ts:38-47` |

Fixed during this run: H-07 (second session while an attempt is OBSERVED/CREATE_UNKNOWN) failed on
`2512c44` and passes on `34a5ba5` after Agent A's `createPgAttempt`.

## 5. Not covered, and why

- **Playwright e2e:** not run. A `next dev` server plus Chromium against `ci_h` was not reasonable on
  the shared machine at the time (load average 14-26 on 8 cores, 16 GB) and the brief forbids heavy
  builds. The PG admin screens (statement import, exceptions, manual allocation, refund approve/complete)
  do not exist yet (Agent F not merged), so the UI journeys in master prompt §19 cannot be exercised
  end-to-end anyway. The server side of those journeys is covered by the route- and DB-level tests above.
- **Real SIGKILL:** crashes are simulated by persisted lease state, not by killing a process.
- **Redis unavailable:** tests run with `REDIS_URL` unset (in-process cache only).
- **Real gateway / real bank:** none. Gateway is a stub reproducing the documented contract
  (`docs/flavrly-pg/UPSTREAM_CONTRACT.md`); no authorized bank feed exists (contract D4).
- **Fork paise offset end-to-end through the webhook route:** covered at engine level by `lead-paise-offset.test.ts`, not through a signed Standard-Webhooks body in H tests.
