# Flavrly PG — upstream gateway contract (as read from source, 2026-10-24)

Owner: Agent A. Read-only research; nothing in the gateway repos was modified or built.

Refs compared:

- **UP** = upstream `youpi-pg/YouPI-PG` main `d7b07414` ("fix(security): repair PR #78 merge defects",
  on top of PR #78 "require merchant API key on payment creation").
- **FORK** = our deployed fork, local checkout `flavrly-pg/repo`, branch `flavrly/pg-hardening` @ `7720b49`.
  Merge-base `3fe33ce`; FORK is 96 commits behind UP and 69 commits ahead (its own hardening).
  Package scope differs (`@youpi/*` vs `@flavrly/*`), but the HTTP surface is the same.

Citations are `path:line` inside the gateway repo at the stated ref (`git show <ref>:<path>`).
Paths: `PR` = `apps/payment-api/src/routes/payments.routes.js`, `AG` = `apps/payment-api/src/auth-guard.js`,
`MR` = `packages/db/src/repositories/merchant.repository.js`, `SR` = `packages/db/src/repositories/payment-session.repository.js`,
`RA` = `packages/db/src/repositories/receiving-account.repository.js`.

## 1. Payment create — `POST /api/v1/payments`

| Aspect | UP d7b0741 | FORK 7720b49 |
|---|---|---|
| Merchant selection | `X-Merchant-Id` header or `body.merchantId`; absent => default merchant (PR:36-42) | same (PR:144-150) |
| Auth on create | `X-Merchant-Key` (or `body.merchantKey`) verified by `MR.verifyApiKey` = sha256(apiKey) **or** webhookSecret (PR:49-59, MR:166-177). Alternative `X-Order-Token` = hex HMAC(webhookSecret, `merchantId:orderId:amountPaise:CUR`) (PR:60-73). No credential => only the **default** merchant may create, else 401 `MISSING_MERCHANT_KEY` (PR:74-90). A **wrong** key is always 401 `INVALID_MERCHANT_KEY`. | **No** credential check on create. The key is consulted only to authorise `autoActivate` (PR:128-136, 223-230). Rate limit 30/min/IP, 300/min/merchant (PR:50-81, 157-166). |
| apiKey provisioning | `api_key_hash` defaults to sha256(webhookSecret) (MR:59); no admin route sets a distinct apiKey (only `webhookSecret` updates, `admin.routes.js:731,934`). In practice merchantKey == webhookSecret. | No `apiKey`/`verifyApiKey` at all in MR. |
| orderId | any non-empty (PR:92) | `^[A-Za-z0-9._\-:/#]{1,64}$` (PR:10, 173-179) |
| Currency | any, stored (PR:104) | INR only, else 400 `UNSUPPORTED_CURRENCY` (PR:181-184) |
| Amount | `toPaise(body.amount)` (string rupees) (PR:97-103) | same + >0 and <= `MAX_PAYMENT_AMOUNT_PAISE` (default Rs 1,00,000) (PR:193-211) |
| Response | 201 `{paymentId, orderId, amount, amountPaise (string), currency, status: INITIATED, queuePosition, checkoutUrl}` (PR:364-373) | same (PR:449-458) |

Flavrly sends `X-Merchant-Id`, `X-Merchant-Key` (= `merchantKey || webhookSecret`) and `Idempotency-Key`
(`src/server/payments/youpi-api.ts`). This is accepted by both refs.

### 1.1 Idempotency semantics (both refs)

- `Idempotency-Key` is read (UP PR:33, FORK PR:141) and **only stored** in `payment_sessions.idempotency_key`
  (UP PR:342, FORK PR:427). It is not unique and never used for lookup. **It provides no idempotency.**
- De-duplication is by `(merchant_id, order_id)`: `SR.findByOrderId` returns the newest row (UP SR:56-66, FORK SR:115-125),
  and a partial unique index allows at most one non-terminal/SUCCESS session per merchant order
  (`packages/db/src/sqlite-schema.sql` UP:132-135, FORK:133-136; `migrate.js` UP:75, FORK:78).
- Duplicate create for the same orderId:
  - same amount and currency, existing SUCCESS => **200** with the existing session (UP PR:178-190, FORK PR:266-278);
  - same amount, existing INITIATED/QUEUED/ACTIVE/PROCESSING => **200** `activeSessionDetected: true`, same paymentId
    and checkoutUrl (UP PR:213-244, FORK PR:295-326), unless the session is device-bound to another device => 409
    `DUPLICATE_SESSION_DETECTED`;
  - different amount/currency => **409** (`ORDER_AMOUNT_MISMATCH` UP PR:166-176; `ORDER_AMOUNT_CONFLICT` FORK PR:254-264);
  - previous session terminal (FAILED/EXPIRED/CANCELLED) => a **new** session with the same orderId (UP PR:246-249, FORK PR:328-332).
- Consequence for Flavrly: the gateway orderId we send must be the attempt key (`<orderId>-<cuid>`), so a retry of a
  create with the same attemptKey is idempotent (returns the same session), and a new attempt never re-attaches to an
  old one. `idempotencyKey = attemptKey` is still sent but must not be relied on.

## 2. Status read — `GET /api/v1/payments/:id`

- Public view (any caller): `paymentId, orderId, amount, amountPaise (string), currency, status, method, completedAt`;
  terminal statuses mapped by `toPublicOutcome` (SUCCESS/FAILED/EXPIRED/CANCELLED), non-terminal returned raw
  (UP PR:377-399, FORK PR:462-484).
- Private view (owner): adds `internalStatus, verificationLevel, verificationSources, verificationTag, returnUrl, metadata`
  (UP PR:406-414, FORK PR:491-499). `metadata.receivingAccountSnapshot = {id, upiId, payeeName, isMerchantEnabled}` is
  written at create from the merchant's active receiving account (UP PR:257-268, 322-325; FORK PR:340-351, 406-409).
- Owner proof (`isPaymentOwner`): admin bearer, observer bearer, or `X-Merchant-Key`:
  UP accepts apiKey **or** webhookSecret via `verifyApiKey` (AG:83-97); FORK accepts **webhookSecret only** (AG:85-95).
  => If a distinct `merchantKey` is ever configured, it works on UP but FORK returns only the public view (no
  `metadata`), and our receiver readback fails closed. Keep `merchantKey` unset (or equal to webhookSecret) on FORK.
- **No `utr`** in either view. **No `expiresAt`** in either view.
- Status values: `INITIATED` (created, customer not yet signed in at checkout, no slot/timer), `QUEUED`, `ACTIVE`
  (slot held, 5 min timer, `packages/core/src/timing-engine.js` UP:19, FORK:30), `PROCESSING` (UP 30 s, FORK 5 min,
  timing-engine UP:20, FORK:31), then `SUCCESS | FAILED | EXPIRED | CANCELLED`.
- SUCCESS means the gateway's observer/verification attributed a bank alert. It is an **observation**, not bank proof (D2).

## 3. Lookup by merchant orderId (resolving an unknown create)

`GET /api/v1/orders/:orderId/cod` with `X-Merchant-Id` (header or `?merchantId=`) exists in both refs
(UP PR:459-510, FORK PR:543-593). Despite the name it works for any session: it calls `findByOrderId(merchant, orderId)`
and returns `{paymentId, orderId, amountPaise, currency, method, status (raw internal), verificationTag, placedAt}`;
`metadata` (incl. `receivingAccountSnapshot`) only when the caller is the owner (`X-Merchant-Key`, see §2).
404 `Order not found` when no session exists for that merchant+orderId. This is what `resolveUnknownAttempt()` uses,
with the attemptKey as orderId.
Caveat: a 404 immediately after a client-side timeout can race a create still executing on the gateway, so Flavrly
only treats 404 as "never created" after a grace period.

## 4. Merchant / receiving-account model (how the payee is chosen)

- The payee is **not** taken from the request. Create uses `accountRepo.findActiveForMerchant(merchant.id)`
  (RA:71-78, both refs), the single `is_active` account per merchant (unique index `idx_single_active_vpa_per_merchant`,
  `sqlite-schema.sql` UP:33, FORK:32). Changing the active VPA (`admin.routes.js` `/api/v1/admin/upi-accounts/:id/activate`,
  UP:507, FORK:583) silently changes the payee for all **new** sessions of that merchant.
- Merchants: both refs seed exactly one default merchant in `packages/db/src/migrate.js` (UP:126, FORK:127). There is
  **no API to create further merchants** (upstream issue #89 "merchent key problem", OPEN). One gateway merchant =
  one active VPA. So "per-restaurant merchant" means a separately provisioned merchant row (manual DB/admin work) or a
  separate gateway instance; a shared platform merchant can safely serve **at most one** restaurant (D7).
- FORK only: the customer is asked to pay `amount + 0..99 paise` (`MAX_PAISE_OFFSET`, FORK SR:5-6; allocated when the
  slot is granted, FORK SR:203-214, 277; `expected_amount_paise`). The status views do **not** expose it. FORK webhooks
  carry it as `paidAmountPaise` in the Standard-Webhooks body only (FORK `webhook.repository.js:186-187`), not in the
  legacy flat body. **The bank credit on FORK can differ from the order amount by up to 99 paise** — bank matching
  (Agent C) must account for this; UP has no offset.

## 5. Webhooks (for Agent B)

### UP d7b0741 (`packages/core/src/webhook-engine.js`)
- Sent after the terminal transition, fire-and-forget (`apps/payment-api/src/index.js:181,198,209,220`). The delivery
  row is inserted **after** the HTTP attempt (webhook-engine:152-169) => a crash between status commit and insert loses
  the event (issue #86, open).
- Body (webhook-engine:95-111): `{event: SUCCESS|FAILED|EXPIRED|CANCELLED, deliveryId, timestamp (ms), paymentId,
  orderId, attemptId, amount, amountPaise (number), currency, method, utr, verificationTag, verificationLevel,
  completedAt, metadata}`. `utr` from the attributed observation (webhook-engine:80-89).
- Headers (webhook-engine:117-124): `X-Gateway-Event`, `X-Gateway-Signature: sha256=<hex HMAC-SHA256(webhookSecret, body)>`,
  `X-Gateway-Signature-V2: sha256=<hex HMAC(webhookSecret, "<timestamp>.<body>")>`, `X-Gateway-Delivery-Id`,
  `X-Gateway-Timestamp` (ms). HMAC helper: `packages/common/src/crypto.js:71-73`.
- Retries (webhook-engine:183-298): max 5 attempts, backoff 5 s, 30 s, 2 m, 10 m, 1 h; body resent byte-identical with
  the **original** timestamp and deliveryId (webhook-engine:237-255). => any receiver with a 5-minute freshness window
  rejects every retry after 5 minutes. Freshness must be checked only on first sight, dedupe by deliveryId.

### FORK 7720b49 (`packages/core/src/webhook-dispatcher.js`, `packages/db/src/repositories/webhook.repository.js`)
- Transactional outbox: terminal event recorded inside the status-change transaction (`recordTerminalWebhookEvent`,
  webhook.repository:199-217; dedupe key `terminal:<sessionId>`, :250-258) plus a sweep that re-creates missing events
  (webhook-dispatcher:525-540). Fixes #86 on FORK.
- Endpoint created from `merchants.webhook_url/webhook_secret` as a legacy endpoint (webhook.repository:571-580),
  `legacy_format` default 1 (`sqlite-schema.sql:213`).
- Legacy body (webhook-dispatcher:217-236): `{event, paymentId, orderId (merchant's), amount, amountPaise, currency,
  method, utr, verificationTag, verificationLevel, completedAt, metadata}` — no deliveryId/timestamp in body.
- Headers (webhook-dispatcher:269-282): `X-Gateway-Event`, `X-Gateway-Signature: sha256=<hex HMAC(secret, body)>`
  (oldest non-expired secret during rotation, :253-261), `X-Gateway-Delivery-Id` (= stable event id),
  `X-Gateway-Timestamp` (ms, **fresh on every attempt, not covered by the legacy signature**), plus Standard Webhooks
  `webhook-id`, `webhook-timestamp` (s), `webhook-signature: v1,<base64 HMAC(key, "id.timestamp.body")>` one per active
  secret (whsec_ keys base64-decoded, :186-196). No `X-Gateway-Signature-V2`.
- Retries: 7 retries at 5 s, 5 m, 30 m, 2 h, 5 h, 10 h, 10 h (+/-20% jitter), honours 429 Retry-After (<= 1 h), then DEAD;
  endpoint auto-disabled after 5 days of failures (webhook-dispatcher:16-38, 292-311).

### Implications for Flavrly inbound webhook (B)
- Only the HMAC-over-raw-body `X-Gateway-Signature` is common to both refs. Timestamp is authenticated only by UP's
  `-V2` header or FORK's `webhook-signature`; plain `X-Gateway-Timestamp` is attacker-controllable on FORK.
- Dedupe on `X-Gateway-Delivery-Id` (stable across retries in both refs).
- A 5-minute window on `X-Gateway-Timestamp` drops all UP retries; on FORK it passes but proves nothing.
- Treat the body (incl. `utr`) as an observation only (D2/D5).

## 6. Flavrly-side consequences (implemented by Agent A)

- Gateway orderId = `attemptKey = <orderId>-<cuid>` (<= 64 chars, matches FORK pattern).
- Create outcome classification: 2xx with `paymentId`+`checkoutUrl` = created; 4xx except 408/409 = definitive reject
  (no session written; FORK rate limiting and validation happen before insert); 408/409/5xx/network/timeout/malformed
  2xx = **unknown** (a session may exist).
- Before returning a checkout URL: private readback must show `orderId == attemptKey`, `amountPaise == expected`,
  `currency == INR`, `metadata.receivingAccountSnapshot.upiId == bound account VPA`. Otherwise REVIEW_REQUIRED.
- Private status requests use `merchantKey || webhookSecret` (works on UP; on FORK only if they are equal).
- No `expiresAt` from the gateway: Flavrly sets its own reuse window for an AWAITING_PAYMENT attempt; an INITIATED
  remote session can still be paid later, so a late payment on an older attempt remains possible and must go to
  reconciliation (never auto-released).
