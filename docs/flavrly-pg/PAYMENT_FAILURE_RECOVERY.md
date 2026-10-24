# Flavrly PG — payment event failure and recovery (Agent B)

Scope: the inbound gateway webhook, the inbound inbox worker, the transactional outbox, and the job
leases. Contract decisions: D3, D6, D10 and D11 in `ARCHITECTURE_AND_DATA_FLOWS.md`. Status as of
2026-10-24, branch `pg/b-webhooks`.

## 1. Flow

```
gateway --POST--> /api/payments/youpi/webhook
            the route verifies, then INSERTs a PaymentWebhookEvent; it answers 200 only after commit
                     |
   pg-worker tick (cron, every minute)  +  a best-effort inline attempt right after the insert
                     |
   runInbox():   claim (lease) -> record observation -> reconcileYoupiPayment -> processed
   runOutbox():  claim (lease) -> handler(topic)  [ORDER_RELEASE, ... wired by the lead]
   sweep:        gateway status poll for in-flight payments (PgJobLease 'youpi-reconcile-sweep')
```

The webhook body is never treated as proof of payment. The worker stores the signed UTR and amount
as a `GATEWAY_WEBHOOK` observation and then runs reconciliation. Only `allocateBankCredit()` can set
a payment to CAPTURED (D3).

## 2. What the receiver checks, in order

| # | Check | Result when it fails |
|---|---|---|
| 1 | Body is at most 64 KiB. Checked against Content-Length and again while streaming, before any HMAC work. | 413 |
| 2 | Body is valid JSON. | 400 |
| 3 | Candidate secrets resolve. The body's `orderId` (attemptKey) or `paymentId` finds a PgPaymentAttempt, which gives the restaurant; `IntegrationCredential(restaurantId, YOUPI).webhookSecret` is used, plus `webhookSecretPrevious` while `now < webhookSecretRotatedAt + 24h`. The platform secret is used only for legacy rows with no attempt, or for the one binding whose `gatewayMerchantId` equals the platform `merchantId`. | DB error: 503. No candidate secret: 503 |
| 4 | Signature is a timestamp-binding HMAC-SHA256, compared in constant time. Accepted: Standard Webhooks `webhook-signature` (fork) or `X-Gateway-Signature-V2` (upstream). The body-only `X-Gateway-Signature` alone is rejected. | 401 |
| 5 | Header and body agree. Delivery id: `X-Gateway-Delivery-Id` = `webhook-id` = body `deliveryId` or envelope `id`; for V2 the body copy is required. Upstream body `timestamp` equals the header. `X-Gateway-Event` equals body `event`/`type`. A payment identity is present. | 400 |
| 6 | Timestamp is fresh: within 5 minutes either way. If stale, the request gets 200 `deduped` only when `youpi:<deliveryId>` is already stored, and nothing is re-run. An unknown stale delivery is never stored. | 400 |
| 7 | INSERT `PaymentWebhookEvent` with provider `youpi`, `restaurantId`, `nextAttemptAt = now`. | Unique violation: 200 `deduped`. Any other DB error: 503, so the gateway retries |

Configuration keys read from `IntegrationCredential.configEncrypted`: `webhookSecret`,
`webhookSecretPrevious` and `webhookSecretRotatedAt` (ISO 8601). If `webhookSecretRotatedAt` is
missing, the previous secret is not accepted.

## 3. Gateway webhook semantics (verified from source and by SIGKILL tests)

| | Upstream YouPI `d7b0741` | Flavrly fork `7720b49` (webhooks v2) |
|---|---|---|
| Delivery id | random UUID per dispatch, in the header and in the signed body | stable `evt_…` per event; `webhook-id` = `X-Gateway-Delivery-Id`; the legacy flat body has no id |
| Timestamp-binding signature | `X-Gateway-Signature-V2` = `sha256=hex(HMAC(utf8 secret, "<ts>.<body>"))` | `webhook-signature` = `v1,base64(HMAC(key, "<id>.<ts>.<body>"))`, one per non-expired secret; key is the base64 after `whsec_`, otherwise utf8 |
| Body-only signature | `X-Gateway-Signature` | `X-Gateway-Signature` (signed with the oldest secret) |
| Retry timestamp | original timestamp resent, so legitimately stale after 5 minutes | re-signed with a fresh timestamp |
| Retry body | byte-identical | byte-identical |
| Schedule | inline first attempt (10s timeout); then 5s, 30s, 2m, 10m, 1h with maxRetries 5. Working this out from the code gives about 4 HTTP attempts. Then abandoned, with no DLQ. | 5s, 5m, 30m, 2h, 5h, 10h, 10h (±20% jitter), then DEAD. 429 Retry-After honoured (capped at 1h). Endpoint auto-disables after a 5-day failure streak. |
| Body sent to the merchant webhook URL | flat body: `event`, `deliveryId`, `timestamp`, `paymentId`, `orderId`, … | legacy flat body (`legacy_format=1`): `event`, `paymentId`, `orderId`, `amountPaise`, `utr`, … |
| Upstream #86 (terminal webhook lost on crash) | **Reproduced** (SIGKILL during first delivery leaves 0 rows and 0 retries) | **Fixed** for `transitionToTerminal` (transactional outbox). Residual gaps, COD route and `banCustomer`, plus a 15-minute sweep window, were patched locally on `flavrly/b86-verify` `8388326` (not pushed). |

Consequences for the Flavrly receiver:

- A first delivery that hits our 503 (for example, DB down) and is then retried more than 5
  minutes later works with the fork, because it re-signs. With upstream it is rejected as a stale
  unknown delivery. The gateway-status sweep (`youpi-reconcile-sweep`) is the safety net for that
  case.
- Both gateways deliver at least once (fork kill point c resends after a 200), so the
  `youpi:<deliveryId>` dedupe is required.
- Licensing for redistributing fork patches is unresolved (upstream #56/#58). Keep the patch local.

## 4. Inbox and outbox mechanics

- **Claim.** A single statement: `UPDATE … SET leaseOwner, leaseExpiresAt = now + 2m,
  attempts = attempts + 1 WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`. Concurrent workers never
  get the same row.
- **Crash.** The lease expires and the row is reclaimed. Each crash still uses up an attempt, so a
  row whose processing keeps crashing workers is dead-lettered once its budget is spent.
- **Fencing.** Every finish write includes `WHERE leaseOwner = me`, so a worker whose lease expired
  cannot overwrite the result.
- **Backoff.** 30s·2^(n-1) ±20%, capped at 1h. Inbox: 8 attempts. Outbox: 10 attempts.
- **Dead letter.** Inbox rows get `deadLetteredAt` plus a `PgReconException WEBHOOK_DEAD_LETTER`
  (dedupe `WEBHOOK_DEAD_LETTER:<eventId>`). Outbox rows get `status = DEAD` plus
  `OUTBOX_DEAD_LETTER`. An unknown outbox topic is retried and then dead-lettered; it is never
  dropped.
- **Outcomes.** `processed = true` means the notification was consumed, not that money arrived.
  These are retried: an unmatched local payment and an indeterminate gateway verification.
- **Outbox writes.** `enqueueOutbox(tx, …)` uses `INSERT … ON CONFLICT DO NOTHING`. A duplicate
  never aborts the caller's transaction, and a rolled-back transaction leaves no intent.
- **Time.** All lease SQL uses `timezone('utc', now())`, because Prisma `DateTime` columns are UTC
  `timestamp without time zone`. A bare `now()` is off by hours on a non-UTC database server (the
  test DB runs America/Toronto).
- **Job leases.** `PgJobLease` uses INSERT … ON CONFLICT DO UPDATE WHERE expired, with a heartbeat
  every ttl/3. It replaces the old `pg_try_advisory_lock`, whose unlock could run on a different
  pooled connection.

## 5. Metrics (`/api/platform/jobs/pg-worker/run` response and the `pg.worker.metrics` log)

`inboxPending`, `inboxRetrying`, `inboxLagSec` (age of the oldest unprocessed event),
`inboxDeadLettered`, `outboxBacklog`, `outboxRetrying`, `outboxLagSec`, `outboxDead`.

The starting alert thresholds below are **not yet based on measured normal behaviour**. Revise them
after the pilot.

- Page when `inboxDeadLettered` or `outboxDead` increases.
- Warn when `inboxLagSec > 300`, or when `outboxLagSec > 300` (an order may be stuck in
  PAYMENT_PENDING).
- Warn on any `pg.worker.stage_failed`, `pg.job_lease.lost`, `youpi.webhook.store_failed` or
  `youpi.webhook.no_secret` log line.
- Track the rate of `youpi.webhook.auth_failed` and `youpi.webhook.stale_unknown_delivery`. A spike
  means misconfigured secrets or a replay attempt.

## 6. Runbooks

**Webhook endpoint returned 503 (DB outage).** No action is needed for correctness. The fork
retries with fresh signatures. Upstream retries after 5 minutes are rejected as stale, and the
reconcile sweep recovers those payments by polling status. Check `inboxLagSec` after recovery.

**Dead-lettered inbound event.** Find it with `PgReconException kind=WEBHOOK_DEAD_LETTER`, and read
`detail.lastError`.
- Unmatched local payment: check the attempt mapping by `orderId`/`paymentId`.
- Indeterminate: check the gateway status API and credentials.

After fixing the cause, replay with:

```sql
UPDATE "PaymentWebhookEvent" SET "deadLetteredAt" = NULL, "attempts" = 0, "nextAttemptAt" = timezone('utc', now()) WHERE id = '<id>';
```

Then resolve the exception. Replay is safe because processing is idempotent and never trusts the
body's status.

**Dead-lettered outbox row (for example ORDER_RELEASE).** Fix the handler or wire the topic, then:

```sql
UPDATE "PgOutbox" SET status = 'PENDING', attempts = 0, "nextAttemptAt" = timezone('utc', now()) WHERE id = '<id>';
```

Handlers are idempotent; ORDER_RELEASE is a no-op unless the order is still PAYMENT_PENDING.

**Worker stuck or lease held.** A `PgJobLease` row expires on its own (2 minutes per stage,
5 minutes for the sweep). Delete it only if the holder process is confirmed dead.

**Customer says "paid" but the order is pending.** Check the inbox row for the attempt
(`PaymentWebhookEvent.orderId = attemptKey`), then the evidence and bank allocation (Agent C). A
webhook alone never releases the order.

**Secret rotation.** Write the new `webhookSecret`, move the old one to `webhookSecretPrevious`, and
set `webhookSecretRotatedAt = now`. The old secret is accepted for 24h. The integrations cache TTL is
5 minutes. Note that the fork expires the old secret on its side immediately for the legacy
endpoint, so update the gateway and Flavrly together.

## 7. Not done / open

- Cron entry for the worker. `deploy/flavrly-jobs.cron` is not owned by Agent B; the lead should
  add: `* * * * * … curl -fsS -m 60 -X POST -H "x-internal-secret: $INTERNAL_CRON_SECRET" https://flavrly.in/api/platform/jobs/pg-worker/run`.
- `applyWebhookObservation()` in `pg/inbox.ts` still calls only `reconcileYoupiPayment`. At
  integration the lead adds `recordObservation({...webhookObservation(ev), paymentId})` from
  `pg/reconcile-engine.ts`.
- No outbox handlers are registered yet (`pg/outbox-handlers.ts`).
