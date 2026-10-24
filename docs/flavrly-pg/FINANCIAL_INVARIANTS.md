# Flavrly PG — financial invariants

Each invariant names where it is enforced (code and/or database) and the test that proves it.
Paths are relative to `apps/web/`. Engine = `src/server/pg/reconcile-engine.ts`;
Pg migration = `prisma/migrations/20261024000100_flavrly_pg_financial_layer/migration.sql`;
DB tests = `tests/db/reconcile-engine.test.ts` (run with `npm run test:db` against real Postgres 16).

| # | Invariant | Enforced | Proven by |
|---|---|---|---|
| I1 | `Payment.status = CAPTURED` for a youpi payment is written only by `allocateBankCredit()` | Engine `allocateBankCredit` (201), the only `PaymentStatus.CAPTURED` write in `src/server/pg` and `payments/youpi-reconcile.ts` (engine 327-331) | `__tests__/server/payments/youpi-reconcile.test.ts` asserts `payment.updateMany` is never called on SUCCESS; `tests/db/youpi-reconcile.test.ts:17` |
| I2 | Gateway SUCCESS (status or webhook) = OBSERVED, never CAPTURED | Engine `recordObservation` (76), state change only at 146; `payments/youpi-reconcile.ts:87` | DB test :201; `tests/db/youpi-reconcile.test.ts:17` (status SUCCESS alone -> PENDING) |
| I3 | Only authenticated, exact-amount evidence can move an attempt to OBSERVED | Engine 118-130 | DB tests :221, :228 |
| I4 | One bank transaction is allocated at most once | DB: `PgAllocation_bankTransactionId_key` (migration 349); code: `FOR UPDATE` on attempt (49), bank txn (215), order (218); `ALREADY_ALLOCATED` short-circuit | DB test :31 — 20 concurrent calls -> 1 allocation, 19 `ALREADY_ALLOCATED`. Mutation check: removing `FOR UPDATE` makes this test fail with P2002 (unique index still blocks the double allocation) |
| I5 | One order gets at most one live ORDER_PAYMENT allocation (one release) | DB partial unique index (migration 425-431); engine classifies the 2nd credit as OVERCOLLECTION (engine 265-279) | DB tests :51 and :71 (direct insert rejected with P2002) |
| I6 | Matching needs same receiving account, CREDIT, INR, exact integer paise, reference == observed UTR, value date within `[createdAt-10min, createdAt+48h]`, txn UNMATCHED, approved source | Engine 245-262; window constants 32-33 | DB tests :87 (1 paisa), :99 (other account), :113 (no UTR), :123 (window) |
| I7 | Never match by amount alone; ambiguity -> exception, no allocation | Engine `tryAllocateBankTxn` 388-417 (candidates by account + observed UTR; >1 -> AMBIGUOUS_MATCH) | DB test :132 |
| I8 | UTR is account-scoped, not global | DB unique `(receivingAccountId, direction, bankReference)` (migration 346) | DB test :99 (same UTR on two accounts coexists, only own account allocates) |
| I9 | Late credit (dead attempt or cancelled order) never releases the order | Engine `late` (273) -> LATE_PAYMENT allocation + exception, no outbox | DB tests :143, :157 |
| I10 | Capture, allocation, event and release intent are atomic | One `prisma.$transaction` (engine 212-355): allocation, txn ALLOCATED, attempt CAPTURED, Payment CAPTURED, `PgFinancialEvent`, `PgOutbox(ORDER_RELEASE, dedupeKey ORDER_RELEASE:<orderId>)` | DB test :31 (1 outbox row, 1 PAYMENT_CAPTURED event) |
| I11 | Financial events are append-only | DB trigger (migration 456-466); code only inserts (`src/server/pg/ledger.ts:25-43`) | DB test :301 (Prisma update/delete and raw UPDATE rejected) |
| I12 | Money amounts are positive integer paise | DB CHECKs (migration 444-451); `decimalToPaise` / `parseInrAmount` (`src/server/pg/bank-source.ts:81`) never use floats | DB test :309; `__tests__/server/pg/bank-source.test.ts` |
| I13 | Manual bank entries need a second, different person | `bank-ingest.ts:65` (MANUAL -> PENDING_APPROVAL), `:267` (approver != enterer); engine 246 refuses unapproved MANUAL | DB test :278 |
| I14 | Manual allocation is dual-control | Engine 203-209 (different users + reason), propose/approve 422-460 | DB test :165 |
| I15 | Reversal is recorded, never silently undone; order untouched | Engine `recordReversal` 465-512 (allocation.reversedAt, txn REVERSED, REVERSAL exception) | DB test :184 |
| I16 | Exceptions are idempotent and resolutions attributable | `src/server/pg/exceptions.ts:22-58` (ON CONFLICT DO NOTHING by dedupeKey), `:69-100` (actor + resolution required) | DB test :335 |
| I17 | One VERIFIED receiving account per gateway merchant id and per restaurant | DB partial unique indexes (migration 435-441) | DB test :315 |
| I18 | Legacy youpi payments without an attempt are never auto-captured | `payments/youpi-reconcile.ts:58-70` | `tests/db/youpi-reconcile.test.ts:36`; unit test "legacy youpi payment" |

## Lock order

Every writer locks in the order PgPaymentAttempt -> PgBankTransaction -> Order
(engine 49, 215, 218). `recordReversal` locks only the bank transaction; `approveManualBankTransaction`
locks only the bank transaction and calls the engine after commit. No path locks in the reverse
order, so these paths cannot deadlock each other.

## Not covered here (other owners)

- Moving the order PAYMENT_PENDING -> RECEIVED is the `ORDER_RELEASE` outbox handler (Agent D,
  `fulfillment.ts`), dispatched by Agent B's outbox worker. Until those are integrated, a captured
  payment leaves a PENDING `PgOutbox` row and the order stays PAYMENT_PENDING.
- Limit reservation release on FAILED attempts (Agent A, `limits.ts`) is not done by
  `youpi-reconcile.ts`.
- Refund completion dual control (Agent E).
