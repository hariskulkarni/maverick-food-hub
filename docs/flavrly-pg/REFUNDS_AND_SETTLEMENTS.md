# Flavrly PG: refunds, settlements and merchant finance

Owner: Agent E. Contract: [ARCHITECTURE_AND_DATA_FLOWS.md](ARCHITECTURE_AND_DATA_FLOWS.md) D13 and D14. Master prompt §12 and §13.
Code: `apps/web/src/server/pg/refunds.ts`, `apps/web/src/server/pg/reports.ts`, the youpi branches in `src/server/refunds.ts` and `src/server/settlement.ts`.

## 1. Four kinds of money movement

Keep these four apart in every report, message and conversation.

| | What moves | Who holds the money | What Flavrly may claim |
|---|---|---|---|
| **A. Direct-to-merchant UPI** (Flavrly PG, `Payment.providerName = 'youpi'`) | Customer's UPI transfer goes straight into the restaurant's own bank account | The restaurant | Nothing was settled or paid out by Flavrly. A payment is "captured" only after bank evidence is allocated (D3). |
| **B. Aggregator/PSP-settled** (PhonePe, Razorpay) | The PSP collects, deducts its fee and settles to the platform account | PSP, then Flavrly | Flavrly owes the restaurant a payout of A − C + D |
| **C. Platform commission receivable** | Nothing moves automatically | — | For A-type orders, commission, fees and taxes are an amount **the restaurant owes Flavrly** (`commissionReceivable`). It has to be invoiced and collected. |
| **D. Actual payouts/transfers** | A real bank transfer from Flavrly to the restaurant | — | Only for B-type money. The settlement engine computes it. It does not execute or confirm transfers. |

Settlement engine (`buildSettlementReport`) per delivered order:
- Rail detection: the order has a `Payment` with `providerName 'youpi'` and status `CAPTURED` or `REFUNDED`. Then `settlementMode = DIRECT_TO_MERCHANT`.
- Direct UPI: `paymentFee = 0`, because no PSP was in the money path and the generic `paymentFeePct` is not applied. `payout (E) = 0`. `collectedByMerchant (F) = A`. `commissionReceivable (G) = C − D`.
- PhonePe, Razorpay and COD: unchanged. The `settlementMode` is `PLATFORM_COLLECTED` and F = G = 0.
- `E = A − C + D − F + G` holds on every line. The xlsx export shows rows F and G and three trailing order-level columns.
- **Open for finance or a CA:** G currently includes GST on fees, TCS (§52) and TDS (§194O), the same deductions as for PSP orders. Whether TCS and TDS apply when Flavrly never collects the consideration must be confirmed before invoicing.

GMV and sales reports (`/api/platform/reports/*`, `/api/admin/reports/*`) now exclude `PAYMENT_PENDING`. An unpaid Flavrly PG order enters the reports only after the bank-verified release moves it to `RECEIVED`. Other rails never place an order in `PAYMENT_PENDING`, so their numbers are unchanged.

## 2. Reconciliation report (§13)

`buildPgReconciliationReport({ restaurantId, from, to })` returns one row per payment attempt created in the window. All money is in integer paise.

| Column | Source |
|---|---|
| orderId, orderCode, orderStatus | Order |
| attemptId, gatewayId, attemptKey, gatewayMerchantId | PgPaymentAttempt |
| merchant, receivingAccount | Restaurant name; masked VPA and last 4 digits of the account (never the full number) |
| utr | Bank reference of the ORDER_PAYMENT allocation, otherwise the observed UTR |
| expected / observed / bankConfirmed | `expectedAmountPaise`; latest authenticated gateway or observer evidence (this is **not** proof of money); sum of live bank allocations of all kinds |
| reconStatus | Attempt state |
| refundStatus, refundedPaise, refundPendingPaise | PgRefundRecord + Refund |
| adjustmentsPaise | Live OVERCOLLECTION + LATE_PAYMENT allocations: money received beyond the order, which is owed back |
| feesPaise | 0 for direct UPI |
| platformCommissionPaise | The settlement engine's commission for the delivered order, converted exactly. This is a receivable. |
| netMerchantValuePaise | bankConfirmed − refunded − fees − commission |
| exceptionReason | Open or acknowledged PgReconException rows |

`pgReconciliationCsv(report)` produces an RFC 4180 CSV with CRLF line endings. Any text cell that starts with `= + - @`, a tab or CR is prefixed with `'`, which prevents spreadsheet formula injection.

**Tenant rule:** the caller passes a `restaurantId` resolved from the session (merchant) or chosen by a super-admin. Never take it from a merchant's request. Agent F builds the UI and routes on top of these functions.

## 3. Refund procedure (direct UPI)

The YouPI gateway cannot refund (`provider.refund()` returns UNSUPPORTED) and the money is in the restaurant's bank account. Every refund is therefore a **human bank transfer** with a two-person rule:

1. **Request:** `requestPgRefund({ orderId | attemptId, amountPaise, reason, actor, kind })`
   - `kind` is `ORDER`, `OVERCOLLECTION` or `LATE_PAYMENT`. Each kind has its own pot, equal to the bank-allocated money of that allocation kind on the attempt. The sum of non-FAILED refunds plus the new one must fit in the pot. The pot check runs under `SELECT … FOR UPDATE` on the attempt row; a real-DB test shows that 10 parallel full refunds produce exactly one refund.
   - Money observed by the gateway but never bank-allocated has no pot and cannot be refunded.
   - The request creates a `Refund` with status `PENDING` and destination `ORIGINAL_PAYMENT`, meaning *where* the money should go, not that it was sent. It also creates a `PgRefundRecord(MANUAL_BANK, requestedById)`.
   - An ORDER refund moves the order to `REFUND_PENDING`.
   - An optional `idempotencyKey` makes a re-submit return the first refund.
2. **Approve:** `approvePgRefund({ refundId, actor })`. The approver must be a different user from the requester.
3. **Send the money (manual, outside Flavrly):** the restaurant, or whoever operates its bank account, transfers the amount back to the customer's VPA or account from the account that received it.
4. **Complete:** `completePgRefund({ refundId, bankReference, evidence: { note, attachmentRef? }, actor })`
   - Requires the approval and the bank's refund UTR/RRN **typed by a human**. The reference is trimmed and uppercased, must be 6–35 letters or digits, and must not already be used on another refund.
   - Requires an evidence note saying what was checked and where the proof is. No raw statements.
   - Effects: the Refund becomes `COMPLETED` with `providerRef` set to the bank reference. When the whole ORDER_PAYMENT pot is refunded, `Payment` becomes `REFUNDED`, the attempt `REFUNDED` and the order `REFUNDED`. A partial refund sets the attempt to `REFUND_PENDING` and the order to `REFUND_INITIATED`, the same convention the legacy engine uses. OVERCOLLECTION and LATE_PAYMENT refunds leave the order and Payment untouched.
5. **Fail:** `failPgRefund({ refundId, reason, actor })`. The Refund becomes `FAILED`, a `REFUND_FAILED` exception is opened, and the amount becomes refundable again.

Every step appends a `PgFinancialEvent`: `REFUND_REQUESTED`, `REFUND_APPROVED`, `REFUND_COMPLETED` or `REFUND_FAILED`.

**Wallet credit** instead of a bank refund is off by default. It needs `FLAVRLY_PG_ALLOW_WALLET_REFUND=true` and an explicit WALLET choice, still goes through approval, and credits the wallet only on completion. Turn the flag on only with legal and accounting sign-off, because the platform never held this money.

**Existing super-admin route** (`POST /api/platform/orders/[id]`, `refundOrder()`) applies when the captured payment is youpi, or when the order has only youpi attempts:
- WALLET, the route's default, is refused with a clear message.
- ORIGINAL_PAYMENT starts the manual flow above and returns `status: PENDING` with a `note`.

Approval and completion need UI or routes (Agent F).

## 4. Disputes, reversals, duplicates

- **Overcollection** (a second credit for an already-paid order) and **late payment** (a credit after cancellation or expiry): the reconcile engine (Agent C) allocates the credit as OVERCOLLECTION or LATE_PAYMENT and opens an exception with `refundRequired`. The operator refunds it with the matching `kind`, then resolves the exception.
- **Customer dispute / chargeback raised with the customer's bank:** Flavrly has no dispute API. The restaurant's bank handles it. Record the outcome as follows: if money is returned to the customer, complete a refund with the bank reference; if the bank debits the restaurant, Agent C's `BANK_TXN_REVERSED` / REVERSAL exception path books it. Never book both for the same money.
- **Wrong-amount refund already sent:** a COMPLETED refund cannot be edited or failed. Book a correcting refund (if too little was sent), or record the recovery outside the system and resolve it through an exception (if too much was sent). Reversal adjustments for completed refunds are not automated.

## 5. What is manual or not available

- Executing the bank refund, entering its reference, and invoicing and collecting the commission receivable are all manual.
- There is no source-refund API, no automatic refund confirmation, and no bank-feed check that a refund debit left the account.
- No UI or routes for approve, complete or fail yet (Agent F).
- Refund kind is stored in `Refund.providerData.pgKind` until a schema column exists (request sent to Agent C and the lead).
