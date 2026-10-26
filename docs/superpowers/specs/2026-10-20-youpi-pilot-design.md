# YouPI-PG — Limited Live Pilot Integration (Design Spec)

**Date:** 2026-10-20
**Status:** Approved for implementation planning
**Scope:** Add YouPI-PG as an **opt-in, per-restaurant, experimental** payment provider in Flavrly, for a **limited live pilot** (real but low-value, reconciliation-gated). Audited gateways (PhonePe/Razorpay) remain primary/default.

## 0. Why this spec exists / the risk

YouPI-PG self-declares **"Research Project — Experimental Use Only… not certified, bank-approved, NPCI-approved, audited, or production-ready."** Payment confirmation is observer-based (SMS/Gmail/notification parsing) and the README warns it is **not conclusive proof of settlement**, amount-matching is **not a payment-identity check**, and consumers must **never fulfill on frontend events** or use it as the **sole source of truth**; guideline **≤20 txns/day per receiving account**. This spec's entire job is to wrap that unreliable "maybe-paid" signal in enough safety that a pilot cannot deliver goods for an unsettled payment or double-credit.

## 1. Hard safety invariants (code-enforced, non-negotiable)

1. **Opt-in only.** YouPI is selectable for a restaurant only when that restaurant has a CONNECTED `YOUPI` `IntegrationCredential`. Never a default; never auto-selected.
2. **Prod guard.** In production, attempting to use YouPI without an opted-in CONNECTED credential throws (mirrors C1 mock-provider guard). No silent fallback.
3. **PENDING-until-reconciled.** An order is **never** marked PAID/CAPTURED from: a browser/frontend event, the webhook body alone, or an observer alert. It flips to PAID **only** after `verifyStatus()` against YouPI's status API returns `CAPTURED`, applied via a status-preconditioned single-winner `updateMany` (the audited C3/C7 pattern).
4. **Dual-path confirmation.** Webhook (fast path) **and** a reconcile poller (primary truth / contingency). Both re-verify via the status API and converge on the same single-winner state machine. The poller works even if the webhook never fires.
5. **Raw-HMAC webhook.** HMAC-SHA256 over the **raw, unparsed request bytes** before any JSON parse (README mandate), using the per-restaurant `webhookSecret`. Reject on mismatch.
6. **Replay/idempotency.** Dedupe on `X-Gateway-Delivery-Id`; reject deliveries outside a timestamp window; a delivery is processed at most once (new idempotency table).
7. **Caps.** Per-restaurant **daily transaction count cap (default 20)** and a **max-amount ceiling**, enforced **atomically** at checkout (atomic conditional UPDATE like the coupon-usage pattern). Over cap → refuse, fall back to an audited gateway.
8. **No cross-tenant exposure.** Credentials + payments scoped by `restaurantId`, fail-closed.

## 2. Architecture (mirrors the audited PhonePe flow)

### 2.1 Provider adapter — `src/server/payments/youpi.ts`
Implements the existing `PaymentProvider` interface:
- `createPayment({ orderId, amountPaise, restaurantId, … })` → calls YouPI Payment API (`:6100`) to create a payment/checkout session; returns a redirect to YouPI's Checkout Portal (`:7000`) or the QR/intent data. Enforces caps first (atomic).
- `verifyStatus(ref)` → polls YouPI status API → `CAPTURED | PENDING | FAILED | UNKNOWN`. This is the ONLY thing that can authorize PAID.
- `refund(...)` → if YouPI supports it; else returns UNSUPPORTED (refunds handled manually for pilot).
Credentials from `IntegrationCredential(YOUPI)`: `{ baseUrl, merchantId/apiKey, webhookSecret, receivingVpa }`.

### 2.2 Webhook — `src/app/api/payments/youpi/webhook/route.ts`
- Read the **raw body**; compute HMAC-SHA256 with `webhookSecret`; constant-time compare to `X-Gateway-Signature`. Mismatch → 401, no state change.
- Check `X-Gateway-Timestamp` within window; dedupe `X-Gateway-Delivery-Id` (insert into `YoupiWebhookDelivery`; duplicate → 200 no-op).
- Do **not** trust the body's status. Instead, call `verifyStatus()` for `orderId/paymentId`, then apply the single-winner `updateMany` (same as `reconcilePhonePePayment`). Return 200.

### 2.3 Reconcile poller — `src/server/jobs/youpi-reconcile-sweep.ts`
- Advisory-lock guarded (mirrors `phonepe-reconcile-sweep`). Scans YOUPI Payment rows in PENDING older than ~90s, calls `verifyStatus()`, applies idempotently (single-winner), marks abandoned past MAX_AGE. Scheduled via a cron run-route like the other sweeps. **Primary source of truth.**

### 2.4 Caps — atomic enforcement
- A per-restaurant-per-day counter (reuse an atomic conditional UPDATE pattern); checkout increments only if under cap, else refuses. Max-amount checked at createPayment.

### 2.5 Branding (per user requirement)
- For opted-in restaurants, the pay experience is **on-brand**: the Flavrly checkout wrapper + any YouPI handoff/outcome surfaces we control render the **restaurant's storefront branding** (logo from `storefrontConfig`, brand colors, name). Where the flow redirects to YouPI's own Checkout Portal, we pass/display branding where the YouPI config allows (logo/merchant name), and our return/outcome page (success/pending/failed) is fully Flavrly-branded using the restaurant's storefront theme. No generic unbranded payment screens for opted-in restaurants.

## 3. Data model
- **`IntegrationProvider` enum** gains `YOUPI`. Config (encrypted): `{ baseUrl, merchantId, apiKey, webhookSecret, receivingVpa }`; summary shows masked tails + baseUrl + VPA.
- **New table `YoupiWebhookDelivery`**: `{ id, restaurantId, deliveryId @unique, event, orderId, receivedAt }` — idempotency/replay ledger.
- **New table or fields for caps**: `YoupiDailyUsage { restaurantId, day, count }` `@@unique([restaurantId, day])` with atomic increment; max-amount is a config field.
- Payments reuse the existing `Payment` model + provider='YOUPI'; providerRef = YouPI paymentId/UTR.

## 4. Guards recap (where enforced)
- `src/server/payments/index.ts`: return YOUPI adapter only when opted-in CONNECTED; prod-throw otherwise.
- createPayment: cap check (atomic) + max-amount; refuse over cap.
- Only `verifyStatus()==CAPTURED` (via reconcile/webhook-triggered verify) flips order to PAID, single-winner.

## 5. Testing
- Webhook: raw-HMAC verify pass/fail; tampered body → 401; replay (same delivery-id) → no-op; stale timestamp → reject; valid → triggers status re-verify, not blind-trust.
- Poller: advisory-lock overlap guard; PENDING→CAPTURED single-winner; abandoned count; never double-applies.
- Caps: atomic — 21st txn/day refused; over-max-amount refused; concurrent checkout can't exceed cap.
- Prod guard: YOUPI without opt-in throws in prod.
- PENDING-until-reconciled: frontend/webhook-body alone never marks PAID.
- Branding: opted-in restaurant's checkout/outcome renders its storefront branding.

## 5b. Enablement workflow — super-admin approval (required)

YouPI is gated behind an explicit **super-admin approval**, not just a restaurant pasting creds.

- **Super-admin (platform) surface** (`/platform/...`): holds the **YouPI instance connection** config (baseUrl, apiKey, webhookSecret — stored as a platform-level `IntegrationCredential` under the `__platform__` sentinel, like the platform-security blob) + default caps; shows an **approvals queue** of restaurant requests; can **approve / reject / disable** YouPI per restaurant, and the change takes effect in **real time** (next provider-selection read sees it).
- **Restaurant-admin feature-request page**: a dedicated page that explains the self-hosted/experimental gateway with a **prominent CAUTION block** (verbatim from YouPI's own warnings: research/experimental, observer-based confirmation, not a settlement guarantee, ≤20/day, pilot/low-value only, you accept the risk). A **"Request this feature"** button creates a request to the super-admin. Once **APPROVED**, the restaurant admin can set their **receiving VPA** + see status; before approval, YouPI is not selectable.
- **Gating invariant (adds to §1):** the YOUPI provider is selectable for a restaurant **only when** its `YoupiFeatureRequest.status == APPROVED` **and** the platform YouPI connection is configured **and** the restaurant has set its VPA. Approval is the master switch; super-admin can disable at any time (real-time revoke).
- **Data:** new `YoupiFeatureRequest { id, restaurantId @unique, status (REQUESTED|APPROVED|REJECTED|DISABLED), requestedById, requestedAt, decidedById, decidedAt, note }`. Audit each transition.
- **Authz:** request endpoints are restaurant-admin + tenant-scoped; approve/reject/disable + platform config endpoints are **SUPER_ADMIN only**.

## 6. Dependencies / out of scope
- **Live pilot requires a running YouPI-PG instance** + config (baseUrl, merchant/API creds, `webhookSecret`, receiving VPA). The adapter/webhook/poller are built + unit-tested against mocks; the live transaction needs that endpoint. If none exists, stand up an isolated YouPI eval first (like the original Track B) and prove the flow there before any real-customer exposure.
- Refund automation (manual for pilot). High-value/high-volume use (capped out). YouPI's own observer/APK setup (operator's responsibility).
