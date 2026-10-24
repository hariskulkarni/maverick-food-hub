# Flavrly PG — Phase 1 interface contract (lead-owned)

Status: AGREED baseline for all agents. Changes go through the lead.
Base: branch `pg/lead` (from `fix/flavrly-pg-safe-pilot-20261022` @ eebd11f).
Baseline gate @ eebd11f: prisma validate/typecheck/lint/responsive OK, vitest 137 files / 1304 tests pass.

## 1. Core decisions

D1. Public enums untouched. `Payment.status` (PENDING/AUTHORIZED/CAPTURED/FAILED/REFUNDED) and
    `OrderStatus` keep current meaning. New internal states live on `PgPaymentAttempt.state`.
D2. A gateway SUCCESS (status API or signed webhook) = **OBSERVED** only. Never CAPTURED.
D3. `Payment.status = CAPTURED` for a Flavrly PG payment is written ONLY by
    `allocateBankCredit()` in `src/server/pg/reconcile-engine.ts`, inside one DB transaction that also
    creates the `PgAllocation`, sets attempt `CAPTURED`, appends a `PgFinancialEvent`, and enqueues
    `PgOutbox(topic='ORDER_RELEASE')`. Bank evidence (`PgBankTransaction`, CREDIT, exact paise, same
    receiving account, reference == observed UTR, inside time window, status UNMATCHED, from
    BANK_FEED | PROVIDER_SETTLEMENT | STATEMENT_IMPORT | approved MANUAL) is required.
D4. No authorized live bank feed exists today. Deliver: `BankTransactionSource` interface,
    CSV statement import, dual-control manual entry. Automatic real-time bank capture = NOT AVAILABLE
    (external blocker), stated in docs.
D5. UTR comes from the HMAC-authenticated webhook body and is stored as evidence
    (`PgPaymentEvidence`, source GATEWAY_WEBHOOK). Status API lacking UTR no longer blocks; it never
    proved anything anyway.
D6. Order release: outbox handler `ORDER_RELEASE` moves order PAYMENT_PENDING -> RECEIVED via existing
    `transitionOrder` (idempotent: no-op if order not PAYMENT_PENDING; if order cancelled -> create
    LATE_PAYMENT exception instead). Kitchen sees nothing before that.
D7. Merchant binding: a NEW production session requires a VERIFIED `PgReceivingAccount` for the
    restaurant whose `gatewayMerchantId` is unique among VERIFIED accounts (partial unique index).
    Per-restaurant gateway credentials live in `IntegrationCredential(restaurantId, YOUPI)`
    (`merchantId`, `merchantKey`, `webhookSecret`). Platform shared credential may serve at most ONE
    verified binding. Private status readback must match account VPA, amount, attemptKey.
    Disabling (`disabledForNewAt`/SUSPENDED) blocks new sessions only; reconciliation continues.
D8. Attempt identity: `attemptKey = <orderId>-<cuid>` (not count+1). `idempotencyKey = attemptKey`.
    Create timeout / 5xx / network error => attempt `CREATE_UNKNOWN`; a new payable session for that
    order is refused until the unknown attempt is resolved (status probe by attemptKey or expiry +
    probe). Definitive 4xx => FAILED and limit reservation released.
D9. Limits keyed by receiving account (`PgAccountDailyUsage`, `PgLimitReservation`), atomic.
    Released only when attempt provably never became payable.
D10. Inbound webhook: verify -> durable insert (PaymentWebhookEvent with lease columns) -> 200 only
    after commit. Processing by lease-based worker (`pg/inbox.ts`) with attempts/backoff/dead-letter.
    Per-merchant HMAC (try secrets of the binding resolved from body merchant/order; plus previous
    secret during rotation window).
D11. Cron/worker mutual exclusion via `PgJobLease` table (DB lease with expiry), not session advisory
    locks.
D12. Money: integer paise everywhere in pg/*. Convert Prisma Decimal via string (`decimalToPaise`),
    never `Number(x)*100`.
D13. Refunds for direct UPI: manual bank refund with evidence + approver (two different users for
    completion). Never fabricate a reference; no wallet credit unless explicitly chosen by admin and
    allowed by policy flag (default off).
D14. Reports: rail = `providerName='youpi'` => settlement `DIRECT_TO_MERCHANT`; no PSP fee applied, no
    "payout completed" by Flavrly; platform commission shown as receivable.

## 2. Schema (additive; Agent C owns schema.prisma + migrations after this commit)

See `apps/web/prisma/schema.prisma` section `// ==== Flavrly PG financial layer ====`.
Models: PgReceivingAccount, PgPaymentAttempt, PgPaymentEvidence, PgBankTransaction,
PgStatementImport, PgAllocation, PgReconException, PgFinancialEvent, PgOutbox, PgJobLease,
PgAccountDailyUsage, PgLimitReservation, PgRefundRecord. PaymentWebhookEvent gains nullable lease
columns. Raw-SQL-only constraints (migration): partial unique indexes on PgAllocation and
PgReceivingAccount, CHECK amount>0, append-only trigger on PgFinancialEvent.

## 3. Module ownership (src/server/pg/ unless noted)

| File | Owner | Exports |
|---|---|---|
| money.ts | Lead (shared, done) | `decimalToPaise(d)`, `paiseToInrString(p)` |
| ledger.ts | C | `appendFinancialEvent(tx, e)` |
| bank-source.ts | C | `BankTransactionSource`, `NormalizedBankTxn`, `parseStatementCsv()` |
| bank-ingest.ts | C | `ingestBankTransactions(accountId, source, rows, actor)` |
| reconcile-engine.ts | C | `recordObservation()`, `tryAllocateForAttempt(attemptId)`, `tryAllocateBankTxn(txnId)`, `allocateBankCredit()` |
| exceptions.ts | C | `openException(tx, {...dedupeKey})`, `resolveException()` |
| payments/youpi-reconcile.ts | C | status probe -> evidence -> engine |
| prisma/** | C | schema + migrations |
| merchant-binding.ts | A | `resolveBinding(restaurantId, {forNew})` |
| attempts.ts | A | `createPgAttempt(order, ...)`, `resolveUnknownAttempt()` |
| limits.ts | A | `reserveLimit(tx,...)`, `releaseLimit()`, `consumeLimit()` |
| payments/youpi-api.ts, youpi.ts, youpi-caps.ts | A | |
| payments/index.ts, payments/online.ts (youpi branches only) | A | |
| inbox.ts, outbox.ts, job-lease.ts | B | `enqueueOutbox(tx, topic, dedupeKey, payload)`, `runOutbox()`, `runInbox()`, `withJobLease(name, ms, fn)` |
| app/api/payments/youpi/webhook/route.ts, jobs/youpi-*.ts, cron routes | B | |
| fulfillment.ts | D | `handleOrderRelease(payload)` (outbox handler) |
| orders.ts youpi parts, youpi-order-policy.ts, checkout + payment-status UI | D | |
| refunds.ts, reports.ts | E | |
| settlement / export code paths (youpi branches) | E | |
| merchant + platform PG UI pages, admin API routes for PG | F | |
| crm-events.ts | F | `handleCustomerPurchaseEvent(payload)` (outbox handler) |
| .github/workflows, docs/flavrly-pg/SECURITY_THREAT_MODEL.md, COMPLIANCE..., UPSTREAM... | G | |
| tests/db/** (real-Postgres harness), e2e | H | |
| outbox-handlers.ts (registry), docs MASTER/FINAL | Lead | |

Rule: never edit a file you do not own. Need a change elsewhere -> report to lead.
Rule: schema change needed -> request to lead/C, do not edit prisma/.

## 4. As-built data flow (integration, 2026-10-24)

```
Customer checkout (rail=youpi, flag on, binding VERIFIED)
  -> placeOrder: Order PAYMENT_PENDING (no kitchen publish)                      src/server/orders.ts
  -> createPgAttempt: tx{Payment PENDING, PgPaymentAttempt CREATED, PgLimitReservation}
     -> gateway POST /api/v1/payments (X-Merchant-Key, redirect:'error')        src/server/pg/attempts.ts
     -> private readback: receiver VPA + amount + attemptKey must match          (else REVIEW_REQUIRED, no URL)
     -> AWAITING_PAYMENT, checkout URL to browser (timeout/5xx -> CREATE_UNKNOWN, blocks new sessions)
Customer pays by UPI -> money lands directly in the restaurant's bank account
Gateway observes -> signed webhook (Standard Webhooks / V2)
  -> /api/payments/youpi/webhook: 64KiB cap, per-merchant HMAC, freshness, dedupe
     -> PaymentWebhookEvent stored -> 200                                       app/api/payments/youpi/webhook/route.ts
  -> pg-worker (cron 1/min, PgJobLease per stage)                               app/api/platform/jobs/pg-worker/run
     inbox: recordObservation(GATEWAY_WEBHOOK, UTR, payable paise) -> attempt OBSERVED   src/server/pg/inbox.ts
     sweep: status probe -> GATEWAY_STATUS evidence (never capture)             src/server/payments/youpi-reconcile.ts
Bank evidence: merchant/ops CSV statement import or dual-control manual entry -> PgBankTransaction UNMATCHED
  -> allocateBankCredit (row locks; account, CREDIT, exact payable paise, ref == UTR, window)
     tx{PgAllocation, txn ALLOCATED, attempt CAPTURED, Payment CAPTURED, limit consumed,
        PgFinancialEvent, PgOutbox ORDER_RELEASE}                               src/server/pg/reconcile-engine.ts
     (second credit -> OVERCOLLECTION; after cancel/expiry -> LATE_PAYMENT; ambiguity -> PgReconException)
  -> outbox: handleOrderRelease -> transitionOrder(RECEIVED, pgRelease) -> kitchen, notifications, auto-accept
                                                                                src/server/pg/fulfillment.ts
  -> normal order lifecycle; loyalty on DELIVERED (once)                        src/server/orders.ts
Refunds: request -> approve (different user) -> complete with human-entered bank ref   src/server/pg/refunds.ts
Reports: DIRECT_TO_MERCHANT settlement (no PSP fee, commission receivable); reconciliation CSV   src/server/pg/reports.ts
Recovery: expiry of never-paid sessions, unmatched-credit retry, webhook payload retention, dead-letter queues.
Emergency switch: FLAVRLY_PG_NEW_PAYMENTS_ENABLED=false (new checkouts only) or per-account disabledForNewAt;
reconciliation of in-flight attempts continues.
```
