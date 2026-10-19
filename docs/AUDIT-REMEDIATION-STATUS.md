# Audit 2026-10-19 — remediation status

Branch: `fix/audit-2026-10` (off `main` @ `f68678f`, which carries the MSG91 work).
Scope of this effort: all 14 CRITICAL findings and the HIGH findings in the
remediation prompt's Phase 3 groups A–F. One finding per commit, failing-test-first
where the behaviour was unit-testable. Nothing was deployed; no VPS or production
database was touched.

Gate at time of writing: `tsc --noEmit` passes; `vitest run` passes (see the
final line of this doc). The only `Errors` in the suite are 6 pre-existing
unhandled async rejections in `otp-limits.test.ts` (a `getOtpMode`→cache artifact
in test teardown, present before this branch and unrelated to these changes).

Legend: **fixed** = code + (where feasible) a failing-first test landed; **fixed\*** =
fixed, test relies on an existing suite + reasoning (noted); **deferred** = not
implemented, needs work/decision described; **needs-decision** = awaits owner.

---

## CRITICAL

| ID | Status | Commit | Test |
|----|--------|--------|------|
| C1 | fixed | `6ad5238` | payment-provider-guard.test.ts |
| C2 | fixed | `c0edadd` | confirm-mock-payment-route.test.ts |
| C3 | fixed | `a8d805e` | payments-verify-route.test.ts |
| C4 | fixed | `f74cd3a` | pricing.test.ts (wallet/loyalty cap) |
| C5 | fixed | `a72e4e5` | refunds-c5.test.ts |
| C6 | fixed | `9928a07` | rider-payouts-route.test.ts |
| C7 | fixed | `4364f35` | phonepe-overcollection.test.ts |
| C8 | fixed | `02dfcea` | signup-restaurant.test.ts |
| C9 | fixed | `3739a81` | otp-mode-guard.test.ts |
| C10 | fixed | `53a9296` | client-ip.test.ts |
| C11 | fixed | `3e2cdf9` | phone-otp-role.test.ts |
| C12 | fixed | `4062f8c` | order-admin-scope.test.ts |
| C13 | fixed | `c7d0d8b` | kyc-pickverifier.test.ts, kyc-mock-approve.test.ts |
| C14.1–3 | fixed | `8e9b522` | workflow/script only (not deploy-tested; `bash -n` passed) |
| C14.4 | fixed | `511ef7a` | deploy-file only |

### DECISIONS taken (Phase 1), as approved
- **C2** → option (b): keep the mock-confirm route, refuse in production.
- **C10** → confirmed Cloudflare-only ingress; helper uses CF-Connecting-IP → X-Real-IP → last XFF hop.
- **C14.4** → option (a): delete `rm-worker` from the manifest + `deploy.sh` reload.

---

## HIGH

| ID | Status | Commit | Test / note |
|----|--------|--------|-------------|
| H1 | fixed\* | `5526710` | address lookup scoped to customer; query-predicate (no placeOrder unit harness) |
| H2 | fixed\* | `5526710` | menuItem/combo scoped to branch; query-predicate |
| H3 | fixed | `5526710` | delivery-eta-route.test.ts |
| H4 | fixed | `5526710` | order-location-route.test.ts |
| H7 | fixed | `15eff5e` | in-txn cap re-check + Serializable; see constraint note below |
| H8 | fixed | `15eff5e` | status-preconditioned single-winner (orders-state-machine green); constraint note |
| H9 | fixed | `15eff5e` | freebies.test.ts (idempotent restore) |
| H10 | fixed | `15eff5e` | signup-bonus-restore-guard.test.ts |
| H11 | fixed | `008db63` | razorpay-webhook.test.ts (header dedupe) |
| H12 | fixed | `008db63` | razorpay-webhook.test.ts (partial vs full) |
| H13 | fixed | `008db63` | online-payment-row.test.ts |
| H14 | fixed | `008db63` | order-pay-route.test.ts |
| H17 | fixed (decision A) | `008db63` | provider-list.test.ts — see below |
| H18 | fixed\* | `15eff5e` | atomic conditional UPDATE on coupon/offer usedCount; no placeOrder unit harness |
| H20 | fixed | `1eab9ff` | otp-abuse.test.ts |
| H21 | fixed | `1eab9ff` | otp-abuse.test.ts |
| H22 | fixed | `1eab9ff` | crypto.randomInt swap (exercised via send path) |
| H25 | fixed | `1eab9ff` | deliverOtp returns {ok}; hard-fail in prod with a real provider |
| H26 | fixed | `1eab9ff` | standardized on MSG91_AUTH_KEY (legacy fallback) |
| H27 | needs-decision | — | migration drafted below; prod built by db push → needs sign-off |
| H28 | needs-decision | — | migration drafted below |
| H29 | needs-decision | — | migration strategy — recommendation below |
| H5 | deferred | — | upload stored-XSS: validate the stored extension server-side, and stop serving `/uploads` via nginx `alias` (route through the app so CSP/nosniff apply). |
| H6 | deferred | — | NotificationLog body stores full OTP text + admin substring search: stop persisting the code (store a redacted body) and/or drop the search over `body`. |
| H15 | deferred | — | reconcile sweep MAX_AGE + no scheduler guard; add overlap-guarded cron + alerting; add a Razorpay reconciler (none exists). |
| H16 | deferred | — | tip route: charge the customer / idempotency / rate-limit / order-status check before raising rider payable. |
| H19 | deferred | — | Coupon.perUserLimit read nowhere + CouponRedemption unique only on orderId; enforce per-user in the order path (+ DB unique on `(couponId,userId)` — migration). |
| H23 | deferred | — | msg91-widget falls back to client `claimedPhone`; require a signature-verified phone, add a replay/nonce store. |
| H24 | deferred | — | public rider-application create + approve upserts role by phone; require ownership proof, don't flip an existing staff user's role. |
| H30 | deferred | — | add `@@index([branchId, placedAt])` on Order (migration) — reporting endpoints filter on it. |
| H31 | deferred | — | `?force=1` hard-delete cascades leave orphaned wallet/loyalty ledgers; block or reconcile before delete. |

### H17 — DECISION taken: Option A (hide Razorpay from the wizard)
The audit asked: hide Razorpay until the handoff works, or implement the handoff.
The Razorpay customer browser handoff is unimplemented (`checkout-form.tsx` routes
away without charging), so an admin enabling it created a rail no customer could
complete. **I chose Option A** (remove Razorpay from `PROVIDER_LIST`, keep it in
the `PROVIDERS` registry so a stored credential still resolves). Rationale: on a
security-remediation branch, shipping an untested live-money browser modal
(Option B) is the opposite of the branch's purpose. The backend for Option B is
~90% present (verify route, HMAC verify, webhook); **follow-up**: build the
browser modal in `checkout-form.tsx` and QA against Razorpay test mode, then
re-add to `PROVIDER_LIST`.

### Concurrency findings — DB-constraint backstops (recommended, need a migration + sign-off)
The H7/H8/H18 fixes are application-level (in-transaction re-checks, a
status-preconditioned write, Serializable isolation, atomic conditional updates).
The audit's stronger recommendation — a DB constraint — is **not shipped** here
because it is a production-schema migration and the migration strategy is the
open H29 decision. Proposed additive constraints for review:
- H8: `CREATE UNIQUE INDEX ON "LoyaltyTransaction"("orderId","type")` — makes a
  double loyalty credit impossible at the DB.
- C7: a partial unique index "at most one CAPTURED payment per order", e.g.
  `CREATE UNIQUE INDEX ON "Payment"("orderId") WHERE "status" = 'CAPTURED'` —
  closes the truly-simultaneous double-capture window the app guard cannot.
- H19: `CREATE UNIQUE INDEX ON "CouponRedemption"("couponId","userId")` with the
  per-user enforcement in the order path.

---

## Findings I believe the audit got slightly wrong (false positives / imprecision)
- **C13 column name:** the audit's blast-radius query referenced
  `KycDocument.details->>'mock'`. The real model is `RiderKycDocument` and the mock
  flag is the `verifierProvider = 'mock'` column — there is no `details` JSON field.
  The query in `audit-blast-radius-queries.sql` uses the correct column.
- **C5 line reference:** audit cited `refunds.ts:167` for `settledNow`; the actual
  optimistic default is a few lines earlier/later depending on tree state — the fix
  is correct regardless.
- Not a wrong finding, but a scope clarification: **C10** names "every IP control";
  I fixed the security-critical sites (middleware, rate-limit, auth allowlist +
  session, cross-sell/offers audit). ~50 further `ipAddress` audit-log writes across
  `platform/**`/`admin/**` share the first-hop pattern but are forensic-only — a
  separate mechanical sweep (listed as follow-up, not a false positive).

## New defects found while fixing (not in the audit)
- **Fifth instance of the optimistic-default pattern** (the one the prompt asked to
  watch for): it did **not** turn up a *new* site beyond C1/C3/C5/C13 and the refund
  path — those four plus the refund `settledNow` are the instances; I did not find a
  fifth distinct one. (C6 rider-payout "PAID" and H25 deliver "ok:true" are the same
  shape — optimistic success that survives the failure path — and are fixed.)
- **otp-limits flakiness:** `sendOtp` fires a `getOtpMode()` promise whose downstream
  cache call can reject after the awaited path completes, producing 6 unhandled
  rejections in the test runner (and, in principle, noisy logs in prod). Not a
  security bug; worth a `void`/await flush. Left unfixed (out of audit scope).
- **kot route** previously used `findUniqueOrThrow` (500 on a missing id); the C12
  fix changed it to a scoped `findFirst` + 404, which is also the correct behaviour.

---

## Read-only SQL — run against PRODUCTION to size the blast radius
These are collected in `docs/audit-blast-radius-queries.sql` (committed in
`ff1e484`). They are **SELECT-only**; run inside `BEGIN TRANSACTION READ ONLY; …
ROLLBACK;` for a hard guarantee. They size:
- **C4** — WalletTransaction ORDER_DEBIT rows (and loyalty) debited beyond the
  order's pre-wallet amount owed → customers to refund.
- **C5** — Refund rows `providerData->>'mock' = 'true'` with status COMPLETED →
  refunds reported done that may never have moved money.
- **C13** — RiderKycDocument rows `verifierProvider='mock'` AND status=APPROVED →
  riders approved by the random mock.

---

## Group E — schema drift (H27/H28/H29): proposed, NOT applied — needs sign-off
The production and demo DBs were built with `prisma db push`, so the four
observability tables and the `META_WHATSAPP` enum value very likely ALREADY EXIST
live. A plain `CREATE TABLE` / `ADD VALUE` under `migrate deploy` would then abort
("already exists"). This requires an owner decision + a DB backup first. Do not
apply blindly.

### H27 — `apps/web/prisma/migrations/20261019_observability_schema/migration.sql`
Creates `ObsErrorLog`, `ObsProbe`, `ObsProbeEvent`, `SiteContent` (full column +
index SQL matching the schema; omitted here for length — generate with
`prisma migrate diff` or use the column list in schema.prisma around L3149–3210).
Use `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, or run
`prisma migrate resolve --applied 20261019_observability_schema` on DBs where the
tables already exist.

### H28 — `apps/web/prisma/migrations/20261019_meta_whatsapp_provider/migration.sql`
```sql
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'META_WHATSAPP';
```
(ADD VALUE appends to the enum; Postgres 12+ allows it outside a txn — Prisma
special-cases it. Safe against DBs that already have the value via IF NOT EXISTS.)

### H29 — DECISION: db push vs migrate deploy
The repo ships BOTH, and which an operator reaches for decides whether a deploy
migrates, hard-aborts, or silently drops columns:
- `prisma db push`: `scripts/fix-prod.sh:105`, `scripts/deploy-remote.sh:69`,
  `scripts/fix-demo.sh:99`, `.github/workflows/ci.yml:56` (and `scripts/deploy.sh`
  transitively).
- `prisma migrate deploy`: `deploy/deploy.sh:82`, `scripts/vps-deploy.sh:37`,
  `docker-compose.yml:44`.

**Recommendation: standardize on `prisma migrate deploy`** (migrations = source of
truth; the team already hand-authors them; db push offers no history/rollback and
can drop columns with `--accept-data-loss`). Required accompanying work (why this
is a DECISION, not a mechanical edit): land the H27/H28 migrations so schema and
history agree, and run a ONE-TIME `prisma migrate resolve --applied <name>` for
every existing migration on each db-push'd prod/demo DB (needs a backup + sign-off)
before the first `migrate deploy`, or it replays `0_init` and aborts. Also note the
`maverick-food-hub/` mirror tree carries identical script copies — confirm live/dead.

---

## Remaining
- MEDIUM / LOW findings: not implemented (Phase 4 is report-only for these).
- The deferred HIGHs above (H5, H6, H15, H16, H19, H23, H24, H30, H31) and Group E
  (H27–H29) are the outstanding work, each with a one-line path above.
- C14 pipeline changes are committed but un-run; the first deploy run is the
  owner's to trigger (and only after the H29 decision, since the deploy now
  fails-loud on detected schema drift).

**Suite at completion:** `tsc --noEmit` exit 0 · `vitest run` → Test Files 66
passed (66), Tests 774 passed (774), 6 pre-existing unhandled errors (otp-limits).
