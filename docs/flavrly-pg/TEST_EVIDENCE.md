# Flavrly PG — test evidence

Date: 2026-10-24. Code under test: `pg/lead` @ `b59f9a2` (`pg/h-qa` = that + H tests; includes
Agents A, B, C, D, E, F, G).

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
| `h-tenant.test.ts` | 11 | Every PG route present (`payments/youpi/status`, `admin/youpi/{vpa,request}`, `admin/pg/{statements,report,refunds/[refundId]}`, `platform/youpi/*` incl. accounts/allocations/bank-entries/exceptions, `platform/jobs/{pg-worker,youpi-reconcile}/run`, PG guards on `orders/[id]/pay` and `admin/orders/[id]/kot`) refuses cross-tenant / wrong-role access; B's data never appears in A's report CSV. |
| `h-retry-guard.test.ts` | 3 | Server refuses a second session while an attempt is OBSERVED or CREATE_UNKNOWN; status page retry offer. |
| total | **77** | **67 pass, 10 fail. Every failure is a reported defect (section 4); none is a harness problem.** |

## 3. Commands and results (Agent H, `pg/h-qa` = `pg/lead` @ b59f9a2 + H tests)

| Command (from `apps/web`) | Exit | Result |
|---|---|---|
| `DATABASE_URL=...ci_h npm run test:db` | 1 | 17 files, 169 tests: 159 pass, 10 fail (all 10 are the H defect tests below; all non-H DB tests pass) |
| `npm run test:ci` | 0 | 151 files, 1539 tests pass (includes PhonePe, Razorpay, refunds, wallet, verify-route, youpi suites) |
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
`2512c44` and passes on `b59f9a2` after Agent A's `createPgAttempt`.

## 5. Not covered, and why

- **Playwright e2e:** not run. A `next dev` server plus Chromium against `ci_h` was not reasonable on
  the shared machine at the time (load average 14-26 on 8 cores, 16 GB) and the brief forbids heavy
  builds. Agent F's screens landed late in this run (`b59f9a2`); their API routes are covered by the
  route-level tests above, the React pages are not exercised by any H test.
- **Real SIGKILL:** crashes are simulated by persisted lease state, not by killing a process.
- **Redis unavailable:** tests run with `REDIS_URL` unset (in-process cache only).
- **Real gateway / real bank:** none. Gateway is a stub reproducing the documented contract
  (`docs/flavrly-pg/UPSTREAM_CONTRACT.md`); no authorized bank feed exists (contract D4).
- **Fork paise offset end-to-end through the webhook route:** covered at engine level by `lead-paise-offset.test.ts`, not through a signed Standard-Webhooks body in H tests.


## Final integrated gate (lead)

Branch `pg/lead` @ `2036bf5` (after the UAT fixes), lead machine (macOS, Node v20.20.2, Postgres 16.15 on :55432, fresh DB per run).
Command: `~/flavrly-pg-evidence/bin/gate.sh` (logs `~/flavrly-pg-evidence/2026-10-24/gate-final4/`; earlier run at `cc9fef2`: `gate-integ2/`, 1542 unit / 170 DB).

| Step | Command | Result |
|---|---|---|
| Prisma client / schema | `prisma generate`, `prisma validate` | exit 0 / exit 0 |
| Migrations from empty | `prisma migrate deploy` | exit 0 (17 migrations) |
| Drift | `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | exit 0 (no drift) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 (pre-existing warnings only) |
| Responsive guardrail | `npm run check:responsive` | exit 0 |
| Unit/route tests | `npm run test:ci` | 152 files, **1545 passed**, 0 failed |
| Real-Postgres tests | `npm run test:db` | 19 files, **172 passed**, 0 failed |
| Production build | `npm run build` | exit 0 |

Baseline before this work (PR #29 head `eebd11f`): 137 files / 1304 unit tests passed, no DB test suite.

Defects found by independent QA (H-01…H-10, H-07) were each reproduced by a failing test first; all now pass on `cc9fef2`.
Not covered by automation: browser rendering of the new admin/platform pages (Playwright not run — see §gaps),
Redis outage, a real gateway/bank feed (external blocker), real SIGKILL of the app (simulated via lease expiry here;
see STAGING_UAT_REPORT.md for process-level drills).

### Local synthetic UAT (Agent S)
9/9 scenarios PASS at `5d321f0`, two full passes from scratch (real app build under `next start`, real fork gateway, signed
webhooks, SIGKILL of gateway and app, real wall-clock expiry, backup/restore drill, flag-off). Report: STAGING_UAT_REPORT.md.
No real money, no production host. Its three findings were fixed in `9236900` with tests (see that report's lead section);
one test assumption in the new DB test was corrected in `2036bf5` (the shared test DB may already hold the sentinel row).

## Round 2 — money audit fixes (`pg/money-r2`, base `pg/lead` @ `fc76238`)

Findings: `~/flavrly-pg-evidence/2026-10-24/round2/PG_AUDIT_FINDINGS.md`. Code at `b24a67e` (docs commit follows).
Machine shared with another release's acceptance run: commands under `nice -n 19`, vitest `--maxWorkers=2`.
Logs: `~/flavrly-pg-evidence/2026-10-24/round2/money-r2/`.

| Step (from `apps/web`) | Exit | Result |
|---|---|---|
| `prisma migrate deploy` into empty `money_r2` | 0 | 18 migrations (new: `20261024000300_flavrly_pg_money_r2`) |
| `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url …money_r2_shadow --exit-code` | 0 | no drift |
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | warnings only, none in round-2 files |
| `npm run check:responsive` | 0 | no forbidden patterns |
| `npx vitest run --reporter=dot --maxWorkers=2` (= `test:ci`) | 0 | 151 files, **1552 passed** (baseline 1545; +12 new, −5 for the deleted dead `youpi-caps` module and its test) |
| `DATABASE_URL=…/ci_money_r2 npm run test:db` | 0 | 21 files, **202 passed** (baseline 172; +9 `r2-money`, +21 `r2-ops`) |
| `npm run build` | not run | per brief (lead runs builds) |

Note: `test:db`'s safety guard requires a database name starting with `ci`, so the DB tests ran on
`ci_money_r2`; `money_r2` / `money_r2_shadow` were used for the from-empty deploy and the drift check.

### New / changed tests and what they prove

| Test | Proves | Red on previous code |
|---|---|---|
| `tests/db/r2-money.test.ts` P0-1 (3) | retry after expiry revives the order and the new credit is CAPTURED + released (not LATE); revive refused when a freebie was already given back; no session for a cancelled order | yes (fc76238 source, `red-p0.txt`) |
| `r2-money` P0-2 (3) | precheck refuses ₹0 / over-cap / daily cap / non-INR read-only; `placeOrder` with wallet covering the total refuses before commit (no order, wallet untouched); the sweep fails a quiet PAYMENT_PENDING PG order but not a fresh or live one | yes |
| `r2-money` P0-3 (2) | manual allocation accepts expected < credit ≤ expected+99 and records the payable; refuses outside the band or a different amount once the payable is known | first yes; second is a guard that already held |
| `r2-money` P0-4 (1) | gateway FAILED -> attempt FAILED, limit released, order PAYMENT_FAILED | yes |
| `tests/db/r2-ops.test.ts` (21) | P1-1 refund route (role, pot cap, second approver); P1-2 late acceptance end to end (self-approval refused, approval moves no money, restaurant confirm captures once, one allocation reclassified, released without auto-accept, decided once; cancelled order refused; decline cancels; other tenant 404); P1-3 void (success path + refusals with evidence, evidence after proposal); P1-4 reversal dual control + reject; P1-5 requeue outbox/webhook, redacted refused; P1-6 stale hold → confirm (no auto-accept, no escalation) / decline → refundable; P1-7 cancel closes attempts, later credit LATE; P1-10 wallet/points restored once on cancel only; P2 manual reject, UTR zeros, retry skip/rotate, refund↔DEBIT link, export label | P2 block yes (`red-p2.txt`); the rest import routes/functions that did not exist (file fails to load) |
| `__tests__/server/pg/attempts.test.ts` (+4, 2 changed) | P1-8 URL kept / regenerated and reused, 90 s re-probe without stale flag; P1-9 bounded live extension; P2 limit release on gateway-dead resolve. Changed by design: "gateway still INITIATED -> EXPIRED" now expires only after the 2 h extension; "remote EXPIRED" now releases the limit when nothing was observed | yes (`red-p1-8-9.txt`) |
| `__tests__/server/pg/fulfillment.test.ts` (+3), `customer-status.test.ts` (+3), `bank-source.test.ts` (+2), `youpi-reconcile.test.ts` (P0-4 asserts) | stale hold and confirmed release; cancelled-order and held views; UTR zeros, txn-date preference; P0-4 calls | written with the code (not separately run red) |
| `tests/db/h-adversarial.test.ts` (1 expectation changed) | gateway FAILED then late credit: order is now PAYMENT_FAILED (was the P0-4 stuck PAYMENT_PENDING) and still never released | n/a |
| `tests/db/reconcile-engine.test.ts` (date fix) | CSV rows use the IST date; the UTC date made the test fail daily 18:30–24:00 UTC. Engine window unchanged | not reproducible at the time of the run (00:51 UTC); fix verified by arithmetic |

Not covered: browser rendering of the new ops/merchant dialogs (no Playwright run); real gateway/bank.

## Round-2 integrated gate (`pg/lead` @ `b3d489c`)

pg/ops-r2 + pg/deps-r2 + pg/money-r2 merged. Fresh DBs `ci_gate_r2` / `ci_gate_r2_shadow` on :55432, commands niced with `--maxWorkers=2`
(a Novaryq acceptance run shared the machine). Logs: `~/flavrly-pg-evidence/2026-10-24/gate-r2/`.

| Step | Exit | Result |
|---|---|---|
| prisma generate / migrate deploy (empty DB) | 0 / 0 | all migrations applied |
| drift (`migrate diff --from-migrations … --exit-code`) | 0 | no difference |
| typecheck / lint / check:responsive | 0 / 0 / 0 | clean (lint warnings pre-existing) |
| test:ci | 0 | **1566 passed** |
| test:db | 0 | **202 passed** |
| build | 0 | GitHub CI run 40149598277 (Web job: migrate, drift, typecheck, lint, responsive, test:ci, test:db, build) green at `a927c8e`; CodeQL green |
