# Flavrly PG — bank reconciliation specification

Status: implemented and tested against real Postgres (`npm run test:db`; engine tests in
`tests/db/reconcile-engine.test.ts`, round-2 additions in `tests/db/r2-money.test.ts` and `tests/db/r2-ops.test.ts`).
Paths are relative to `apps/web/`. See also `FINANCIAL_INVARIANTS.md`, `DATABASE_MIGRATIONS.md`.

## 1. External blocker (contract D4)

No authorized bank/acquirer transaction feed or provider settlement API exists today.
**Automatic, real-time bank-confirmed capture is NOT AVAILABLE.** Nothing in this codebase
calls a bank, scrapes a bank site or simulates a bank API. Bank evidence enters only via:

1. a future authorized feed implementing `BankTransactionSource` (`src/server/pg/bank-source.ts:31-36`) — interface only;
2. CSV statement import by a finance user (`importStatementCsv`, `src/server/pg/bank-ingest.ts:145`);
3. manual entry with a second approver (`enterManualBankTransaction` :215, `approveManualBankTransaction` :253).

Until (1) exists, a youpi payment becomes CAPTURED only after a statement import or an approved
manual entry provides the matching credit. Customers wait in PAYMENT_PENDING meanwhile.

## 2. Data flow

```
gateway webhook (HMAC, carries UTR) ─┐
gateway status read (merchant key) ──┼─> recordObservation ─> PgPaymentEvidence
observer (unauthenticated) ──────────┘        attempt CREATED/AWAITING_PAYMENT -> OBSERVED, observedUtr
                                                       │
CSV statement / manual(+approval) / future feed ─> PgBankTransaction (UNMATCHED)
                                                       │
                     tryAllocateForAttempt / tryAllocateBankTxn  (account + CREDIT + reference == observedUtr)
                                                       │
                                     allocateBankCredit (one tx, FOR UPDATE)
          ┌──────────────────────────────┬─────────────┴──────────────┬──────────────────────────┐
     ORDER_PAYMENT                  OVERCOLLECTION                 LATE_PAYMENT                 REJECTED
 Payment CAPTURED, attempt     order already paid ->          attempt dead / order         invariant failed ->
 CAPTURED, PgOutbox            exception, refund needed,      cancelled -> exception,      exception, credit stays
 ORDER_RELEASE                 no release                     no release                   UNMATCHED
```

## 3. Evidence (recordObservation, `src/server/pg/reconcile-engine.ts:76`)

Input: `{attemptId, source, utr, amountPaise, authenticated, eventAt, dedupeKey, meta}`.
- Idempotent by `dedupeKey` (unique `PgPaymentEvidence.dedupeKey`).
- Stored fields: attempt, restaurant, receiving account, gateway payment id, normalized UTR,
  observed amount, source, verification method, authentication flag, event/processed time,
  match confidence, redacted `meta` (callers must not pass raw SMS/bank text or secrets).
- Only `authenticated` evidence with amount equal to `expectedAmountPaise` (or no amount)
  changes the attempt: CREATED / AWAITING_PAYMENT / CREATE_UNKNOWN -> OBSERVED; sets
  `observedUtr` if empty. A conflicting second UTR opens AMBIGUOUS_MATCH and is not applied.
  An amount mismatch opens AMOUNT_MISMATCH. Never sets CAPTURED.
- Dead attempts (FAILED/EXPIRED/CANCELLED) keep their state but still get `observedUtr`, so a
  late credit can be identified and booked as LATE_PAYMENT.
- `reconcileYoupiPayment` (`src/server/payments/youpi-reconcile.ts:87-109`) records status
  SUCCESS as `GATEWAY_STATUS` evidence with dedupeKey `GATEWAY_STATUS:<attemptId>:SUCCESS`.
  The status API carries no UTR (D5); the UTR comes from the HMAC-verified webhook, which
  Agent B records as `GATEWAY_WEBHOOK` evidence.

## 4. Bank transactions

Identity: `(receivingAccountId, direction, bankReference)` (account-scoped; migration line 346).
`bankReference` is normalized: whitespace removed, upper-case, and an all-digit reference (UPI UTR/RRN)
loses its leading zeros (`normalizeBankReference`, `bank-source.ts`); the same function normalizes observed
UTRs, so `001234567890` on a statement matches `1234567890` from the gateway. Whitespace/upper-case is
enforced by a CHECK.

Ingest (`ingestBankTransactions`, `bank-ingest.ts:49`):
- `INSERT ... ON CONFLICT DO NOTHING` per row; an identical re-import counts as duplicate.
- Same identity with a different amount or date is NOT overwritten: DUPLICATE_CREDIT exception.
- Status: MANUAL -> PENDING_APPROVAL; all other sources -> UNMATCHED.
- Every insert appends `BANK_TXN_INGESTED` to `PgFinancialEvent`.
- New UNMATCHED rows are offered to `tryAllocateBankTxn`.
- Credits that match no attempt stay UNMATCHED and visible (they are never deleted or
  hidden because an order expired) and open a deduped `UNMATCHED_CREDIT:<txnId>` exception,
  auto-resolved when the credit is later allocated.
- One failing allocation does not stop the others; failed credits stay UNMATCHED and are
  retried by `retryUnmatchedCredits()` (reconcile-engine, called by the pg worker), which
  also covers a credit that arrived before the UTR-bearing webhook. It skips credits that have an
  open exception other than UNMATCHED_CREDIT (an invariant the engine already refused, e.g. AMOUNT_MISMATCH)
  until an operator resolves it, and rotates the rest by `updatedAt`, so refused credits never starve
  new ones. `recordObservation`
  additionally tries allocation right after it sets `observedUtr`.

### CSV statement import (`parseStatementCsv`, `bank-source.ts:173`)

Column mapping is supplied per bank (header names, matched case-insensitively):
`date`, optional `valueDate`, optional `narration`, `reference`, `credit`, optional `debit`,
and `dateFormat` (`DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`, `DD-MMM-YYYY`, `DD MMM YYYY`).

- Header row = first row containing every mapped column (preamble lines skipped).
- Amounts: `₹`, `INR`, `Rs`, commas and spaces stripped; must match `^\d+(\.\d{1,2})?$`;
  converted with `decimalToPaise` (string arithmetic, no floats).
- Exactly one of credit/debit must be non-zero.
- Dates have no time: pinned to 23:59:59.999 IST of that day (`bank-source.ts:120`), so
  the window check never puts a same-day credit before its attempt. The transaction `date` wins;
  `valueDate` is used only when the transaction date cell is empty (a later value/settlement date
  would push a same-day credit out of the match window).
- Narration: VPA local parts masked, digit runs of 6+ masked to `XXXX` + last 4, truncated to
  64 characters (`redactNarration`, :70).
- Rejected rows are returned with line number and reason; nothing is guessed.
- File dedupe: `PgStatementImport` unique `(receivingAccountId, fileSha256)`; re-uploading the
  same bytes of a COMPLETED import returns the original import id and inserts nothing.
  COMPLETED is written last. An import that failed (status FAILED) or is PROCESSING for more than
  15 minutes (`STALE_IMPORT_MS`, presumed crashed) is resumed by re-uploading the same file; the
  claim is an atomic conditional update, and rows are idempotent anyway.

### Manual entries (dual control)

`enterManualBankTransaction` stores PENDING_APPROVAL with `enteredById`.
`approveManualBankTransaction(id, approverId)` locks the row, refuses `approverId == enteredById`,
sets UNMATCHED + `approvedById`, appends `BANK_TXN_APPROVED`, then tries allocation.
The engine also refuses any MANUAL row without `approvedById` (`reconcile-engine.ts:246`).

## 5. Matching and allocation (`allocateBankCredit`, `reconcile-engine.ts:201`)

Locks: attempt, bank transaction, order (`FOR UPDATE`, in that order). Then all must hold:

| Check | Failure -> exception kind |
|---|---|
| txn status UNMATCHED (ALLOCATED -> `ALREADY_ALLOCATED`, no exception) | AMBIGUOUS_MATCH |
| MANUAL source has `approvedById` | AMBIGUOUS_MATCH |
| same `receivingAccountId` | WRONG_ACCOUNT |
| direction CREDIT | AMBIGUOUS_MATCH |
| currency INR on both | AMOUNT_MISMATCH |
| `amountPaise == expectedAmountPaise` exactly | AMOUNT_MISMATCH |
| attempt has `observedUtr` (auto mode) | MISSING_UTR |
| `bankReference == observedUtr` (auto mode) | AMBIGUOUS_MATCH |
| `valueAt ∈ [createdAt − 10 min, createdAt + 48 h]` (auto mode) | LATE_PAYMENT |

Classification after the checks:
- attempt FAILED/EXPIRED/CANCELLED or order CANCELLED*/PAYMENT_FAILED -> **LATE_PAYMENT**
  allocation + exception (`refundRequired: true`), no capture, no release;
- order already has a live ORDER_PAYMENT allocation, another CAPTURED payment, or the attempt
  is already CAPTURED -> **OVERCOLLECTION** allocation + exception, no release;
- otherwise **ORDER_PAYMENT**: allocation, txn ALLOCATED, attempt CAPTURED, Payment
  PENDING/AUTHORIZED -> CAPTURED, `PAYMENT_CAPTURED` event, `PgOutbox` row
  `{topic:'ORDER_RELEASE', aggregateId: orderId, dedupeKey:'ORDER_RELEASE:'+orderId,
  payload:{orderId, attemptId, paymentId}}`.

Candidate search:
- `tryAllocateForAttempt` (:358): no `observedUtr` -> MISSING_UTR exception; otherwise the
  unique credit `(account, CREDIT, observedUtr)` if present.
- `tryAllocateBankTxn` (:388): attempts on the same account whose `observedUtr` equals the
  reference; 0 -> stays UNMATCHED; >1 -> AMBIGUOUS_MATCH exception; 1 -> allocate.

Manual allocation (operator resolves MISSING_UTR / ambiguity): `proposeManualAllocation`
(operator + reason, stored as an append-only `MANUAL_ALLOCATION_PROPOSED` event) then
`approveManualAllocation` by a different user, or `rejectManualAllocation` by any super admin (the
proposer may withdraw). One decision per proposal: approval and rejection write the same unique
`MANUAL_ALLOCATION_DECIDED:<proposalId>` event, so a rejected proposal can never be approved later.
Manual mode skips only the UTR and time-window checks; account, direction, currency, status and
approval checks still apply. Amount: exact, except that when the attempt has no gateway-signed
payable amount (the payable-bearing webhook was lost), a manual allocation accepts
`expected < credit <= expected + 99` paise (the fork offset band) and records the credit amount as
`payableAmountPaise` in the same transaction. Once a payable is known, only that exact amount matches.

### Accepted late payment (round 2)

A LATE_PAYMENT allocation can become the order's payment only through
`allocateBankCredit({acceptLate})`, after two super admins (propose + approve, `pg/ops-actions.ts`)
and a restaurant admin (confirm, `decideHeldRelease` in `pg/fulfillment.ts`). Under the same locks
(attempt -> bank txn -> order) it re-checks: the credit's allocation is a live LATE_PAYMENT of this
attempt; the order is PAYMENT_PENDING or PAYMENT_FAILED (never cancelled or released); no live
ORDER_PAYMENT allocation and no CAPTURED payment on the order; no non-failed LATE_PAYMENT refund. It
then revives PAYMENT_FAILED -> PAYMENT_PENDING (refused if a coupon/wallet/bonus/freebie was already
given back), **reclassifies the single allocation** LATE_PAYMENT -> ORDER_PAYMENT (one allocation per
credit; the partial unique index still allows one live ORDER_PAYMENT per order), sets attempt and
Payment CAPTURED, consumes the limit, resolves the LATE_PAYMENT / RELEASE_HELD exceptions and appends
`ALLOCATION_RECLASSIFIED` + `PAYMENT_CAPTURED`, and enqueues `ORDER_RELEASE` with
`restaurantConfirmedById` (released without the stale hold and without auto-accept).

## 6. Reversals

`recordReversal({bankTransactionId, reason, actorId, requestedById})`: allocation `reversedAt` set
(frees the partial unique slot), txn REVERSED, `BANK_TXN_REVERSED` event (actor = approver,
`data.requestedById` = requester), REVERSAL exception. The order and Payment are not changed; an
operator decides (refund/recovery) via the exception. Operators book it only through the dual-control
`REVERSAL` ops action (`/api/platform/youpi/ops-actions`): a different super admin approves, and the
reversal runs inside the approval transaction.

## 6a. Refund DEBIT reconciliation (round 2)

A completed manual bank refund (`PgRefundRecord.bankReference`, typed by a human) is linked to the
statement DEBIT row on the same receiving account with the same (normalized) reference **and** the same
amount: `PgRefundRecord.bankTransactionId` is set (unique), the DEBIT becomes ALLOCATED and
`REFUND_BANK_LINKED` is appended (`pg/refund-debit.ts`). Whichever arrives second (refund completion,
CSV/feed ingest, or approval of a manual DEBIT entry) makes the link. A mismatch links nothing; the
DEBIT stays UNMATCHED and visible.

## 7. Integration points for other agents

- Agent B: webhook worker calls `recordObservation({source:'GATEWAY_WEBHOOK', authenticated:true, utr, amountPaise, dedupeKey:<event id>})`
  then `tryAllocateForAttempt`; outbox worker dispatches `ORDER_RELEASE`. Lead: switch the
  direct `tx.pgOutbox.create` (`reconcile-engine.ts:345`) to B's `enqueueOutbox` at integration.
- Agent D: `ORDER_RELEASE` handler moves PAYMENT_PENDING -> RECEIVED; if the order was cancelled
  meanwhile it must open LATE_PAYMENT (D6).
- Agent F: finance UI for CSV upload, manual entry + approval, exception queue
  (`resolveException`), manual allocation propose/approve.
- Agent A: attempts must be created with `expectedAmountPaise`, `receivingAccountId`, and state
  AWAITING_PAYMENT once payable; limit release on FAILED.

## Addendum (lead, integration): fork paise offset

The deployed fork (`flavrly/pg-hardening` @ 7720b49) asks the payer for `order amount + k` paise, `k ∈ 0..99`
(`packages/db/src/repositories/payment-session.repository.js:6` `MAX_PAISE_OFFSET = 99`). The bank credit therefore
equals that payable amount, not `expectedAmountPaise`. The fork exposes it only as `paidAmountPaise` in the Standard
Webhooks envelope body (`packages/db/src/repositories/webhook.repository.js:186-187`).

- `PgPaymentAttempt.payableAmountPaise` is set only from an authenticated webhook (`recordObservation`), only when
  `expected ≤ payable ≤ expected + 99` (also a DB CHECK, migration `20261024000200_flavrly_pg_followups`), and never
  overwritten with a different value (that opens AMOUNT_MISMATCH).
- `allocateBankCredit` matches `credit.amountPaise === payableAmountPaise ?? expectedAmountPaise` (exact).
- **Operational requirement:** the fork's webhook endpoint for Flavrly must use the Standard Webhooks envelope, not
  `legacy_format=1`; otherwise `paidAmountPaise` is absent and every offset credit lands in AMOUNT_MISMATCH for manual
  (dual-control) allocation. Upstream main has no offset.
- The ≤ 99 paise excess is retained by the merchant as part of the allocated credit; refunds are bounded by the
  allocated amount. Tests: `tests/db/lead-paise-offset.test.ts`.
