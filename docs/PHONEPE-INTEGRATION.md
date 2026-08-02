# PhonePe Payment Gateway — Standard Checkout V2

How Flavrly takes money through PhonePe: the moving parts, how to configure a
restaurant, how to test it in UAT, and what to check before go-live.

Reference: <https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-integration-website>

---

## The short version

A customer picking "Pay online" at checkout gets PhonePe's PayPage in an iframe
over the Flavrly checkout page. They pay by UPI (intent, QR or collect), card or
netbanking. PhonePe returns them to us, we ask PhonePe's Order Status API what
actually happened, and the order is confirmed on that answer — never on anything
the browser or a webhook claims.

PhonePe coexists with Razorpay. Each restaurant connects whichever gateway it
has a merchant account for, in Storefront CMS → Integrations. A restaurant with
both configured routes through PhonePe.

---

## Why the design looks like this

Two properties of PhonePe drive most of the code, and both are easy to get
wrong.

**PhonePe does not sign webhook bodies.** The `Authorization` header on a
webhook is a static `SHA256(username:password)` — the same string on every
delivery. Anyone who has ever observed one can replay it with a body of their
choosing. So a webhook here authenticates the *caller* but proves nothing about
the *event*. Consequently no webhook ever writes a payment outcome directly: it
authenticates, records the raw event, and then triggers a server-to-server
Order Status call. That call's answer is what gets applied. PhonePe's own
integration guidance says the same thing.

**The browser learns nothing verifiable.** Razorpay hands the client an
`order|payment` HMAC we can check. PhonePe hands back nothing signable, so the
client-side "payment concluded" callback is treated purely as a UI hint. It
routes the customer to a status page; the server decides what happened.

The result is that all four paths — webhook, browser return, status poll and the
sweeper — funnel into one function, `reconcilePhonePePayment`, which is
idempotent and re-runnable. They can race; the outcome is the same.

---

## Conformance details that are easy to get wrong

Small print from PhonePe's reference pages that the summary pages omit. Each of
these is implemented and unit-tested; they're recorded here because every one is
a plausible source of an opaque `BAD_REQUEST` or a silently-ignored setting.

**`paymentModeConfig` needs `"version": "V2"`.** Without it PhonePe falls back to
the old flat format and silently ignores the dimensional filters — you'd think
you'd restricted checkout to UPI-intent and quietly get everything. `createPayment`
injects the version so no caller has to remember. The dimensions are per family:
UPI takes `flows` / `apps` / `instruments`, CARD takes `types` / `networks` /
`variants` / `geoScopes`, NET_BANKING takes `banks`, WALLET takes `wallets`.
Fields AND together, an omitted field means "all", and **only the first
constraint per `type` is processed** — two `CARD` entries won't union.

**`metaInfo` limits are asymmetric.** udf1–udf10 accept any characters up to 256
chars; udf11–udf15 accept only `[A-Za-z0-9_-+@.]` up to 50. We send order id,
order code, restaurant id, branch id and phone in udf1–udf5. `sanitizeMetaInfo`
truncates and strips rather than rejecting — metaInfo is diagnostic breadcrumbs,
never something we key on, so a clipped value must never cost a customer their
payment.

**Order Status has a prescribed polling cadence** (UAT checklist §3): first check
at 20–25s, then every 3s for 30s, 6s for 60s, 10s for 60s, 30s for 60s, then
every 60s. `phonePeStatusPollDelays()` in `src/lib/phonepe-poll.ts` encodes it
once so the browser poll and the server-side sweeper can't drift apart. The
status page passes `skipInitialWait` — the customer's browser returning *is* the
completion signal and the return route has already done check #1, so waiting a
further 20s would just be a spinner. That module is deliberately import-free: it
is used from a client component, and pulling it out of `phonepe-api.ts` is what
keeps `node:crypto` out of the browser bundle.

**Refunds have a four-state lifecycle**, not three: `PENDING → CONFIRMED →
COMPLETED | FAILED`. `CONFIRMED` means accepted but not yet settled, so it maps
to PENDING internally. Treating it as terminal would mark an order REFUNDED
before the customer saw any money.

**Webhook `type` is deprecated.** PhonePe's checklist says to key off
`payload.state` and ignore `type`. We read `event` first and fall back to `type`
only for the event *name*; the state always comes from `payload.state`.

**Token refresh is checked, not blind.** The checklist explicitly warns against
calling the Authorization API before every request. Ours caches and refreshes
only inside a 5-minute margin of `expires_at`.

**`prefillUserLoginDetails.phoneNumber`** pre-fills the customer's mobile on the
PayPage. `toPhonePePhone` only sends it when the value is unambiguously an Indian
mobile (10 digits starting 6–9, optionally `0`/`91`/`091`-prefixed) and returns
null otherwise — a malformed value would fail the whole create-payment call, and
the customer can just type it.

**PayPage branding is dashboard-only.** Brand colour, button text theme and
background image are set in PhonePe Business Dashboard → Settings → Brand Colour,
and apply to both Standard Checkout and Payment Links. There are no API fields
for it, so there is nothing to configure in this codebase.

---

## Architecture

```
checkout-form.tsx
      │ POST /api/orders          (paymentMethod: PHONEPE)
      ▼
placeOrder ──► startOnlinePayment ──► phonepeProvider.createOrder
      │                                      │ POST /checkout/v2/pay
      │                                      ▼
      │                             Payment row: PENDING
      │                             providerRef = <orderId>-<attempt>
      ▼
openPhonePeCheckout({ tokenUrl, scriptUrl })
      │  iframe via mercury checkout.js  (redirect fallback)
      ▼
  customer pays
      │
      ├─► PhonePe webhook ─────► /api/payments/phonepe/webhook ─┐
      ├─► browser returns ─────► /api/payments/phonepe/return  ─┤
      ├─► status page polls ───► /api/payments/phonepe/status  ─┼─► reconcilePhonePePayment
      └─► nothing happens ─────► phonepe-reconcile sweep ───────┘        │
                                                                        │ GET /checkout/v2/order/{id}/status
                                                                        ▼
                                                        Payment CAPTURED → maybeAutoAccept
                                                        Payment FAILED   → customer-safe message
```

### Files

| File | Role |
|---|---|
| `src/server/payments/phonepe-api.ts` | HTTP client: OAuth token cache, pay, order status, refund, refund status |
| `src/server/payments/phonepe-events.ts` | Pure helpers: webhook auth, event normalisation, status mapping, error copy. No I/O — fully unit-tested |
| `src/server/payments/phonepe.ts` | `PaymentProvider` adapter + credential resolution |
| `src/server/payments/index.ts` | Gateway selection (`resolveGatewayKey`, `paymentProvider`) |
| `src/server/payments/online.ts` | `startOnlinePayment` — the one place a checkout is opened |
| `src/server/payments/reconcile.ts` | The single writer for payment and refund outcomes |
| `src/server/jobs/phonepe-reconcile-sweep.ts` | Safety net for lost webhooks and dead checkouts |
| `src/lib/phonepe-checkout.ts` | Browser: loads mercury checkout.js, iframe with redirect fallback |
| `src/app/api/payments/phonepe/webhook/route.ts` | Inbound webhook |
| `src/app/api/payments/phonepe/return/route.ts` | Customer return (GET **and** POST) |
| `src/app/api/payments/phonepe/status/route.ts` | Authenticated status poll |
| `src/app/api/orders/[id]/pay/route.ts` | Retry / pay-later — mints a fresh PayPage |
| `src/app/(customer)/checkout/payment-status/` | "Confirming your payment…" landing page |
| `src/app/api/platform/jobs/phonepe-reconcile/run/route.ts` | Cron entry point for the sweep |

### Data model

No new tables. The existing columns carry PhonePe:

| Column | Holds |
|---|---|
| `Payment.method` | `PHONEPE` (new enum member) |
| `Payment.providerName` | `'phonepe'` |
| `Payment.providerRef` | **our** `merchantOrderId` = `<orderId>-<attempt>` |
| `Payment.providerData` | PhonePe payloads, plus `_`-prefixed fields of ours (`_attempt`, `_expireAt`, `_transactionId`, `_paymentMode`, `_feeAmount`, `_capturedAt`) |
| `Refund.providerRef` | our `merchantRefundId` |
| `PaymentWebhookEvent.provider` | `'phonepe'` |
| `IntegrationCredential.provider` | `PHONEPE` (new enum member), AES-GCM encrypted blob |

Migration: `prisma/migrations/20260801_phonepe_payment_gateway/` — two
`ALTER TYPE … ADD VALUE IF NOT EXISTS`. Nothing destructive; safe to run on a
live database.

> **Note on `providerRef`.** The Razorpay path overwrites `providerRef` with the
> gateway payment id on capture. The PhonePe path deliberately does not: refunds
> are addressed by the original `merchantOrderId`, so overwriting it would
> strand the refund path. The transaction id lives in `providerData._transactionId`.

---

## Configuring a restaurant

### 1. Get V2 credentials

PhonePe Business Dashboard → **Developer Settings** → API Keys. You need
`client_id`, `client_secret` and `client_version`.

These are the **V2** OAuth credentials. The older Merchant ID + Salt Key + Salt
Index pair is deprecated and produces `404 / Key_not_configured` against these
endpoints. If your dashboard only shows V1 credentials, raise a support ticket
with PhonePe asking for V2 access.

### 2. Register the webhook

Same dashboard → **Webhooks** → Add:

- **URL** `https://<your-domain>/api/payments/phonepe/webhook`
- **Auth type** SHA
- **Username / Password** — invent any pair; you will paste the same pair into Flavrly
- **Events** `checkout.order.completed`, `checkout.order.failed`, `pg.refund.accepted`, `pg.refund.completed`, `pg.refund.failed`

The URL must be HTTPS, must not contain an IP address or port, and must accept
POSTed JSON.

### 3. Whitelist your domain

PhonePe blocks payments whose originating host is not the one onboarded on your
merchant account — you will see `INTERNAL_SECURITY_BLOCK_1`. Only **one** URL per
merchant ID is allowed (a domain *or* a subdomain, not both), so decide early
whether you onboard `flavrly.in` or `order.flavrly.in`.

Make sure `NEXT_PUBLIC_SITE_URL` matches: it is what builds the `redirectUrl`
sent to PhonePe.

### 4. Connect in Flavrly

Storefront CMS → **Integrations** → PhonePe. Paste client id / secret / version,
set the environment, and paste the webhook username + password. "Test
connection" fetches an OAuth token — a read-only round-trip that moves no money.

### Platform-wide fallback (optional)

For a single-tenant deployment, set the env vars in `.env` instead and leave
per-restaurant credentials empty:

```
PAYMENT_PROVIDER=phonepe
PHONEPE_CLIENT_ID=…
PHONEPE_CLIENT_SECRET=…
PHONEPE_CLIENT_VERSION=1
PHONEPE_ENV=SANDBOX
PHONEPE_WEBHOOK_USERNAME=…
PHONEPE_WEBHOOK_PASSWORD=…
```

Per-restaurant credentials always win over env.

### 5. Schedule the reconciliation sweep

```
*/5 * * * * curl -fsS -X POST https://<domain>/api/platform/jobs/phonepe-reconcile/run \
              -H "x-internal-secret: $INTERNAL_CRON_SECRET"
```

This is not optional in production. It is what closes out payments whose webhook
never arrived and retires orders whose checkout expired unpaid.

---

## UAT testing

Set the environment to `SANDBOX`. All calls then route to
`https://api-preprod.phonepe.com/apis/pg-sandbox` and the browser loads
`https://mercury-stg.phonepe.com/web/bundle/checkout.js`.

### Test instruments

| Instrument | Value |
|---|---|
| Credit card | `4208 5851 9011 6667`, exp `06/2027`, CVV `508` |
| Debit card | `4242 4242 4242 4242`, exp `12/2027`, CVV `936` |
| OTP | `123456` |
| UPI | PhonePe Simulator app (Android package `com.phonepe.simulator`); iOS access on request |

The sandbox lets you pick the outcome — success, failure, or pending — per
transaction. For UPI QR, scan with a real UPI app rather than the simulator,
then choose the outcome from the prompt.

### Scenarios worth walking

1. **Happy path** — pay by card, land on the status page, watch it flip to
   confirmed and forward to order tracking. Check the order is `RECEIVED`
   (or `ACCEPTED` if auto-accept is on) and the Payment row is `CAPTURED`.
2. **Failure** — choose failure. The status page should show a customer-safe
   message ("Incorrect UPI PIN…"), not a raw bank code, and offer a retry that
   mints a *new* merchant order id.
3. **Pending** — choose pending. The page should keep polling, not declare
   failure.
4. **Customer closes the PayPage** — the iframe callback returns `USER_CANCEL`;
   you should land on the status page, still PENDING.
5. **Webhook** — confirm the `PaymentWebhookEvent` row exists with
   `provider = 'phonepe'` and `processed = true`. Then replay the same delivery:
   it must dedupe (`{ ok: true, deduped: true }`).
6. **Bad webhook auth** — POST the same body with a wrong Authorization header.
   Must be `401`, and must not create a `PaymentWebhookEvent` row.
7. **Lost webhook** — disable the webhook on the dashboard, pay, and let the
   sweep run. The payment should still capture.
8. **Expired checkout** — start a payment, do nothing for 15 minutes, run the
   sweep. Order should move to `PAYMENT_FAILED` and the signup-bonus hold should
   be released.
9. **Refund** — full and partial, to ORIGINAL_PAYMENT. Refund stays `PENDING`
   until `pg.refund.completed` (or the sweep) settles it; a full settled refund
   marks the Payment `REFUNDED` and the order `REFUNDED`.
10. **Double-submit** — hit "Pay now" twice on a paid order. The second must be
    rejected with 409, not open a second checkout.

---

## Error codes

Detailed codes are mapped to customer-safe copy in `phonepe-events.ts`
(`ERROR_COPY`). The ones worth knowing:

| Code | Meaning | What to do |
|---|---|---|
| `Z9` / `IE` | Insufficient balance | Customer retries with another method |
| `ZM` | Wrong UPI PIN | Customer retries |
| `ZA` / `ORDER_CANCELLED_BY_USER` | Customer cancelled | Nothing |
| `Z7` / `Z8` / `U03` / `ZU` | Bank limit exceeded | Customer retries with another method |
| `U90` / `UT` / `U28` / `XB` / `XY` | Bank technical issue | Retry later |
| `INTERNAL_SECURITY_BLOCK_1` | Host is not the whitelisted domain | Fix the onboarded URL / `NEXT_PUBLIC_SITE_URL` |
| `INTERNAL_SECURITY_BLOCK_2` | Server IP differs from registered | Update registered IPs with PhonePe |
| `INTERNAL_SECURITY_BLOCK_6` | Video KYC incomplete | Complete merchant KYC |
| `BF_034` | Insufficient settlement balance for refund | Fund the account, retry |
| `REFUND_FOR_TXN_OLDER_THAN_LIMIT` | Past the 3-month refund window | Refund to wallet instead |

Refunds older than 90 days are rejected locally before the API call, with a
message pointing the admin at the wallet refund.

Transport-level codes: `404 / Key_not_configured` almost always means V1 salt
credentials are being used for a V2 flow. `401` means an expired token — the
client force-refreshes and replays once automatically.

---

## Go-live checklist

- [ ] `PHONEPE_ENV` / the per-restaurant Environment field is `PRODUCTION`
- [ ] Production `client_id` / `client_secret` / `client_version` in place
- [ ] Webhook URL registered on the **production** dashboard with all five events
- [ ] Webhook username/password match between PhonePe and Flavrly
- [ ] Production domain whitelisted with PhonePe, and `NEXT_PUBLIC_SITE_URL` matches it exactly
- [ ] Site served over HTTPS
- [ ] Reconciliation cron scheduled and `INTERNAL_CRON_SECRET` set
- [ ] `Restaurant.paymentFeePct` set to the PhonePe MDR actually negotiated (default is 2.0, tuned for Razorpay) — it drives settlement reports and partner payouts
- [ ] Merchant video KYC complete (else `INTERNAL_SECURITY_BLOCK_6`)
- [ ] One real ₹1 transaction end to end, then refunded

---

## Security notes

- Credentials are AES-256-GCM encrypted at rest (`INTEGRATION_ENCRYPTION_KEY`) and never returned unmasked by the admin API.
- The webhook Authorization header is deliberately **not** persisted on `PaymentWebhookEvent.signature`: it is a reusable credential, not a per-message signature, so storing it would put a working secret in the database for no forensic value.
- Webhook auth comparison is constant-time and rejects malformed headers without throwing.
- `/api/payments/phonepe/status` is session-authenticated and scoped: a customer can only poll their own orders.
- The webhook and return routes are exempt from CSRF and rate limiting by the existing `/webhook` path rule in `src/middleware.ts`; the status and pay routes are rate limited.
- Token cache keys hash the client secret, so a heap dump does not reveal it.

## Known gaps

- **Razorpay's browser handoff is still unimplemented** (it was already a `// Real Razorpay SDK call would go here` stub before this work). A Razorpay tenant places the order and lands on tracking without a checkout opening. PhonePe tenants are unaffected.
- **`paymentModeConfig` is not exposed to admins.** The API client supports it; there is no UI to restrict a restaurant to, say, UPI only.
- **No PhonePe mobile SDK.** There is no customer-facing mobile app in this repo — customers order on the web. See the mobile section in the handover notes.
