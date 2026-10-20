# Flavrly — Role / Route Inventory (baseline, INCREMENT-00)

Snapshot: branch `feat/increment-00` off `main` @ 35fe8de. Counts from `apps/web/src/app` (page.tsx + route.ts).

## Surfaces & route counts
| Area | Pages (page.tsx) | API routes (route.ts) | Primary auth gate |
|---|---|---|---|
| Customer `(customer)` + public | 42 | `api/customer` 29, `api/uploads`, `api/checkout/*`, `api/orders` | `auth()` session; customer-owned resources; many public (storefront/menu) |
| Restaurant admin `/admin` | 41 | `api/admin` 108 | `AdminLayout` requires `role === 'ADMIN'`; API via `requireManagedRestaurant()` (tenant-scoped, `src/server/tenancy.ts`) |
| Platform / super-admin `/platform` | 41 | `api/platform` 104 | `requireSuperAdmin()` + capability `platform:admin` (`src/server/permissions.ts`); nav gated in `platform/layout.tsx` |
| Rider (native + web API) | — (rider-native Expo app) | `api/rider` 53 | `src/server/rider-auth.ts` — HMAC/timing-safe native bearer + role/suspension lookup |
| Payments | — | `api/payments` 6 (phonepe, youpi*) | provider-scoped; webhooks signature-verified |

\* YouPI is a draft/opt-in pilot (not deployed); payment rail selection remains **deferred** per the prompt pack.

## Auth building blocks (per security register — behavior NOT yet remediated here)
- `src/server/auth.ts` — NextAuth; email-password (Argon2 + TOTP + IP) and Google provider. **SEC-01 pending** (Google signIn does not restrict staff roles / suspendedAt).
- `src/server/sessions.ts` — session create/validate/revoke. **SEC-04 pending** (fails open on missing sid / DB error).
- `src/server/rider-auth.ts` — native bearer, 30-day, no session/device id. **SEC-03 pending** (no revocation).
- `src/server/user-totp.ts` — staff TOTP + break-glass. **SEC-10 pending** (break-glass bypass policy).
- `src/server/tenancy.ts` — `requireManagedRestaurant` / `requireSuperAdmin` / `userCanAccessRestaurant` (tenant guards, retained).

## Customer → Kitchen → Rider reference flow (files + reproducible scenario)
1. **Customer order** — storefront `src/app/(customer)/r/[slug]` → `/cart` → `/checkout` (quote `src/app/api/checkout/quote/route.ts`) → `POST src/app/api/orders/route.ts` → `placeOrder` in `src/server/orders.ts`. Server-authoritative: totals, hours, delivery zone/fee (`src/server/delivery/placement.ts` `resolveDeliveryTerms`), minimums, tenant/customer ownership. Order enters the state machine (`ALLOWED_NEXT`, `transitionOrder`).
2. **Kitchen/admin** — `src/app/admin/kitchen` + `src/app/admin/orders`: accept → `PREPARING` → `READY` via `transitionOrder` (guard: `role === 'ADMIN'`, tenant-scoped). Milestone side-effects (SMS/push) fire best-effort.
3. **Rider** — a `READY` delivery order enters the pool; rider claims it in `apps/rider-native/app/(app)/pool.tsx` via `src/app/api/rider/assignments/[id]/accept/route.ts`, then `reach-restaurant` → `pickup` → `reach-customer` → `deliver` (OTP + proof photo `.../[id]/photo/route.ts`); live GPS `src/app/api/rider/location/route.ts` (+ geofence arrival). `DELIVERED` triggers the feedback nudge.

**Reproducible local acceptance (needs a disposable Postgres):** seed a branch + menu item, place an order via `/api/orders` as a synthetic customer, transition it ADMIN→READY, claim + deliver as a synthetic rider, assert the order reaches `DELIVERED` and a `DeliveryLocationPing` + proof row exist. (DB-backed; not run in INCREMENT-00 — see progress doc "remaining dependencies".)
