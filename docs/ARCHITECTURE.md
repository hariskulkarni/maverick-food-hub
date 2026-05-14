# Architecture

## Goals

1. **One deployable** that serves all four surfaces. Reduces ops surface area and lets every surface share types, schema, and realtime channels.
2. **Type-safe end to end.** TypeScript everywhere, Prisma-generated DB types, Zod schemas at every API boundary.
3. **Vendor-portable.** Postgres anywhere, S3-compatible blob storage, payment/SMS/WhatsApp behind adapter interfaces. Deploy to Vercel, Railway, Render, Fly, AWS, GCP, self-hosted Docker — same image.
4. **Mobile-first.** Customer + Rider surfaces are PWA-installable. Admin/Kitchen are responsive but optimized for tablet/desktop.
5. **Real-time without operational pain.** Server-Sent Events for fan-out (no extra Redis/WebSocket gateway needed for MVP). The realtime layer is an interface — swap to Pusher / Ably / self-hosted WS later without touching consumers.

## High-level diagram

```
                       ┌───────────────────────────────────────────┐
                       │                Next.js 15                  │
                       │                                            │
  Customer (PWA)  ───▶ │  (customer)/  ──┐                          │
  Admin (web)     ───▶ │  admin/       ──┤                          │
  Kitchen (tab)   ───▶ │  kitchen/     ──┼──▶  Server Actions       │
  Rider (PWA)     ───▶ │  rider/       ──┤      + /api (REST + SSE) │
                       │                  │                          │
                       │      shared:     ├──▶  server/  (auth, db,  │
                       │      design sys  │      payments, notif,    │
                       │      schema      │      realtime, analytics)│
                       └─────────┬────────┴──────────┬───────────────┘
                                 │                   │
                          ┌──────▼──────┐     ┌──────▼──────┐
                          │  Postgres   │     │  External   │
                          │  + Prisma   │     │  adapters   │
                          └─────────────┘     │  Razorpay,  │
                                              │  Twilio,    │
                                              │  Maps, S3   │
                                              └─────────────┘
```

## Data model overview

The schema (see `apps/web/prisma/schema.prisma`) is built around 7 aggregates:

- **Identity & RBAC** — `User`, `Role`, `OtpToken`, `Address`. Role-based: CUSTOMER / ADMIN / KITCHEN / RIDER. OTP tokens are short-lived and single-use.
- **Restaurant** — `Branch`, `OperatingHours`. Multi-branch ready from day one.
- **Catalog** — `Category`, `MenuItem`, `Combo`, `ComboItem`, `MenuItemAvailability` (time-based). Veg/non-veg flag, prep time, image URLs.
- **Orders** — `Order`, `OrderItem`, `OrderStatusEvent`, `Coupon`, `CouponRedemption`. Full status flow from spec, including Cancelled / Refund Initiated / Payment Failed.
- **Payments** — `Payment`, `Refund`. Adapter-agnostic; Razorpay-specific fields in `Payment.providerData` JSON.
- **Delivery** — `RiderProfile`, `RiderAssignment`, `DeliveryLocationPing` (GPS streaming).
- **Engagement** — `LoyaltyAccount`, `LoyaltyTransaction`, `Wallet`, `WalletTransaction`, `Referral`, `InventoryItem`, `InventoryMovement`.

Status flow strictly enforced server-side in `server/orders.ts`:
```
RECEIVED → ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED
                          │
                          └──▶ CANCELLED  (terminal)
                                REFUND_INITIATED → REFUNDED
                                PAYMENT_FAILED → (recover or cancel)
```

## Auth

- **Customer / Rider** — phone-number OTP via NextAuth credentials provider. OTP generated server-side, stored hashed in `OtpToken`, dispatched via `notifications.sendSMS()` (mock in dev). 6-digit, 5-minute TTL, single-use.
- **Admin / Kitchen** — email + password (Argon2id). Role enforced in middleware (`apps/web/src/middleware.ts`).
- **Sessions** — JWT, signed with `NEXTAUTH_SECRET`. Role embedded in token claim, checked in every server route via `requireRole(...)`.

## Payments

`server/payments/index.ts` defines a `PaymentProvider` interface:

```ts
interface PaymentProvider {
  createOrder(args: CreateOrderArgs): Promise<ProviderOrder>
  verifyPayment(args: VerifyArgs): Promise<VerifyResult>
  refund(args: RefundArgs): Promise<RefundResult>
}
```

Two implementations ship: `RazorpayProvider` (real) and `MockProvider` (local dev — auto-confirms after a configurable delay). Selected via `PAYMENT_PROVIDER` env var.

## Notifications

Same adapter pattern in `server/notifications/`. Channels: SMS, WhatsApp, Email. Twilio + WhatsApp Business + SMTP implementations, with `MockNotifier` that logs to stdout in dev. Each customer-facing notification is templated in `server/notifications/templates/`.

## Realtime

`server/realtime/` exposes `publish(channel, event)` and `subscribe(channel)`. Default implementation is an in-process EventEmitter + per-connection SSE stream at `/api/events?channel=...`. For multi-instance deploys, swap in the Postgres LISTEN/NOTIFY adapter (also included).

Channels:
- `order:{orderId}` — every status change, ETA update, rider location ping
- `branch:{branchId}:orders` — admin/kitchen feed of new + updated orders
- `rider:{riderId}` — assignments, pickups, delivery updates

## Routing & RBAC

Middleware reads the JWT and gates each route group:
- `/admin/**` → ADMIN
- `/kitchen/**` → KITCHEN
- `/rider/**` → RIDER
- `(customer)/**` → public + CUSTOMER (some pages require login)

API routes use `withRole(...)` HOFs for the same enforcement.

## Testing

- **Unit (Vitest)** — pure utils, server logic with a mocked Prisma client.
- **Integration (Vitest + testcontainers)** — real Postgres in Docker, exercises Prisma queries and API handlers.
- **E2E (Playwright)** — three critical flows: customer places order; admin accepts + assigns rider; rider delivers and verifies OTP.

## Performance

- React Server Components by default; client components only where interactivity demands.
- Prisma queries audited for N+1; common reads cached with `unstable_cache`.
- Images served via `next/image` with the configured loader (works with S3, Cloudinary, or local).
- Indices on `Order.status`, `Order.branchId`, `Order.placedAt`, `Order.customerId`, `RiderAssignment.riderId`, `MenuItem.categoryId`, `MenuItem.branchId`.

## Observability

- Structured logs via `pino`, request-scoped via Next middleware.
- Health endpoint at `/api/health`; readiness at `/api/ready` (DB ping).
- Optional OpenTelemetry exporter wired in `server/otel.ts` (off by default).
