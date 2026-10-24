# Flavrly PG — bank reconciliation specification

Status: implemented and tested against real Postgres (`npm run test:db`, 29 tests).
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
`bankReference` is normalized: whitespace removed, upper-case (`normalizeBankReference`,
`bank-source.ts:65`), enforced by a CHECK.

Ingest (`ingestBankTransactions`, `bank-ingest.ts:49`):
- `INSERT ... ON CONFLICT DO NOTHING` per row; an identical re-import counts as duplicate.
- Same identity with a different amount or date is NOT overwritten: DUPLICATE_CREDIT exception.
- Status: MANUAL -> PENDING_APPROVAL; all other sources -> UNMATCHED.
- Every insert appends `BANK_TXN_INGESTED` to `PgFinancialEvent`.
- New UNMATCHED rows are offered to `tryAllocateBankTxn`.
- Credits that match no attempt stay UNMATCHED and visible (they are never deleted or
  hidden because an order expired).

### CSV statement import (`parseStatementCsv`, `bank-source.ts:173`)

Column mapping is supplied per bank (header names, matched case-insensitively):
`date`, optional `valueDate`, optional `narration`, `reference`, `credit`, optional `debit`,
and `dateFormat` (`DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`, `DD-MMM-YYYY`, `DD MMM YYYY`).

- Header row = first row containing every mapped column (preamble lines skipped).
- Amounts: `₹`, `INR`, `Rs`, commas and spaces stripped; must match `^\d+(\.\d{1,2})?$`;
  converted with `decimalToPaise` (string arithmetic, no floats).
- Exactly one of credit/debit must be non-zero.
- Dates have no time: pinned to 23:59:59.999 IST of that day (`bank-source.ts:120`), so
  the window check never puts a same-day credit before its attempt. `valueDate` wins over
  `date` when present.
- Narration: VPA local parts masked, digit runs of 6+ masked to `XXXX` + last 4, truncated to
  64 characters (`redactNarration`, :70).
- Rejected rows are returned with line number and reason; nothing is guessed.
- File dedupe: `PgStatementImport` unique `(receivingAccountId, fileSha256)`; re-uploading the
  same bytes returns the original import id and inserts nothing.

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
`approveManualAllocation` by a different user. Manual mode skips only the UTR and time-window
checks; account, direction, currency, exact amount, status and approval checks still apply.

## 6. Reversals

`recordReversal({bankTransactionId, reason, actorId})` (:465): allocation `reversedAt` set
(frees the partial unique slot), txn REVERSED, `BANK_TXN_REVERSED` event, REVERSAL exception.
The order and Payment are not changed; an operator decides (refund/recovery) via the exception.

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
