# API reference

All endpoints return JSON unless noted. RBAC enforced in `middleware.ts` and per-route via `auth()` checks.

## Auth

| Method | Path | Body | Auth | Notes |
|---|---|---|---|---|
| POST | `/api/auth/otp` | `{ phone, purpose? }` | public | Issues a 6-digit OTP. In dev, returns `devCode` for convenience. |
| POST | `/api/auth/[...nextauth]` | — | public | NextAuth handler. Use `signIn('phone-otp')` or `signIn('email-password')` from the client. |
| GET  | `/api/me` | — | session | Returns current user. |

## Customer / public

| Method | Path | Notes |
|---|---|---|
| GET  | `/api/orders/lookup?code=ORD-XXXXXX` | Public order lookup (returns id only). |
| POST | `/api/orders` | Place an order (session required). |
| GET  | `/api/orders/:id/items` | Reorder helper. Returns line items. |
| POST | `/api/orders/:id/confirm-mock-payment` | Dev only: confirm a mock payment. |
| POST | `/api/checkout/quote` | Compute pricing without placing the order. |
| POST | `/api/addresses` / `DELETE /api/addresses/:id` | Manage saved addresses. |

## Realtime

| Method | Path | Notes |
|---|---|---|
| GET | `/api/events?channel=...` | SSE stream. Channels: `order:{id}`, `branch:{id}:orders`, `rider:{id}`. |

## Admin (role = ADMIN)

| Method | Path | Notes |
|---|---|---|
| GET  | `/api/admin/orders/:id` | Full order with relations. |
| POST | `/api/admin/orders/:id/transition` | `{ status, note? }`. Validates against the state machine. |
| GET  | `/api/admin/orders/:id/suggest-riders` | Distance + load + rating scoring. |
| POST | `/api/admin/orders/:id/assign` | `{ riderId }` |
| POST | `/api/admin/orders/:id/auto-assign` | Picks the best candidate. |
| GET  | `/api/admin/orders/:id/kot` | HTML KOT (auto-prints). |
| GET  | `/api/admin/orders/:id/invoice.pdf` | PDFKit invoice. |
| POST | `/api/admin/menu/items` / `PATCH/DELETE /api/admin/menu/items/:id` | Menu CRUD. |
| POST | `/api/admin/menu/categories` / `DELETE /api/admin/menu/categories/:id` | Category CRUD. |
| POST | `/api/admin/coupons` / `PATCH /api/admin/coupons/:id` | Coupon CRUD. |
| GET  | `/api/admin/reports/orders.csv` / `.xlsx` | Exports. |

## Rider (role = RIDER)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/rider/online` | Toggle online status. |
| POST | `/api/rider/location` | `{ lat, lng, speedKph?, orderId? }`. Streams to `order:{id}`. |
| GET  | `/api/rider/assignments` | Current active assignments. |
| POST | `/api/rider/assignments/:id/accept` |
| POST | `/api/rider/assignments/:id/pickup` | Also moves order → OUT_FOR_DELIVERY. |
| POST | `/api/rider/assignments/:id/deliver` | `{ otp }`. Verifies and marks DELIVERED. |

## Payments

| Method | Path | Notes |
|---|---|---|
| POST | `/api/payments/verify` | Razorpay client callback. Verifies HMAC signature. |
| POST | `/api/payments/webhook` | Razorpay server webhook. Validates `x-razorpay-signature`. |
| POST | `/api/payments/razorpay/webhook` | Razorpay webhook (per-tenant secret, idempotent). |
| POST | `/api/orders/:id/pay` | Open a fresh gateway checkout for an unpaid order (retry / pay later). Customer-scoped. |

### PhonePe (Standard Checkout V2)

Full guide: [PHONEPE-INTEGRATION.md](./PHONEPE-INTEGRATION.md).

| Method | Path | Notes |
|---|---|---|
| POST | `/api/payments/phonepe/webhook` | Inbound webhook. Authenticates `Authorization: SHA256(username:password)` in constant time, dedupes on a synthesised event id, then **re-confirms against the Order Status API** before any state change — the header is replayable, so it is a trigger, not evidence. |
| GET/POST | `/api/payments/phonepe/return` | Where PhonePe returns the customer's browser. Reconciles, then 303s to `/checkout/payment-status`. Accepts both verbs because PhonePe uses either depending on payment mode. |
| GET | `/api/payments/phonepe/status?orderId=` | Authenticated status poll. Each call re-asks PhonePe, so it doubles as the customer-driven recovery path when a webhook is late. Rate limited 60/min. |
| POST | `/api/rider/assignments/:id/collect-online` | Rider opens a PayPage to collect a COD order digitally at the door. Amount is always the order total, never client-supplied. |
| GET | `/api/rider/assignments/:id/collect-online` | Poll that collection until it settles. |
| POST | `/api/platform/jobs/phonepe-reconcile/run` | Reconciliation sweep — captures payments whose webhook was lost, settles stranded refunds, retires expired checkouts. `x-internal-secret` or SUPER_ADMIN. Schedule every 5 min. |

All four confirmation paths (webhook, browser return, status poll, sweep) funnel
into one idempotent writer, `reconcilePhonePePayment`. They may race; the
outcome is identical. A captured payment is never rewritten, and an unreachable
gateway is reported as indeterminate rather than failed.

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | Liveness. |
| GET | `/api/ready` | DB ping; readiness for load balancer. |
