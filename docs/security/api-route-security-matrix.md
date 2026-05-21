# API Route Security Matrix — Maverick Food Hub (`apps/web`)

> Generated audit of every `apps/web/src/app/api/**/route.ts` handler (279 route
> files). DOCUMENTATION ONLY — no code was changed. Classifications come from
> reading the auth helpers in full plus spot-checking ~25 representative routes
> across every group and inferring the rest from path conventions and shared
> per-group `_helpers`.

## How auth is enforced

API routes are **not** protected by the Next.js `middleware.ts` role gates —
the middleware `matcher` covers page prefixes (`/platform`, `/admin`,
`/kitchen`, `/profile`, `/orders`) and explicitly lets `/api/*` through (only
`/api/auth` is special-cased). **Every API route therefore enforces its own
auth in-handler** via one of these helpers:

| Helper | Source | Effect |
|---|---|---|
| `auth()` | `server/auth.ts` | NextAuth v5 session (cookie). Returns `session.user` with `role`. |
| `requireRole([...])` | `server/auth.ts` | `auth()` + throws `403` unless role is in the list. |
| `requireRestaurant()` | `server/tenancy.ts` | Resolves the caller's ACTIVE restaurant (ADMIN/KITCHEN membership); throws `404` if none. Tenant scope. |
| `requireSuperAdmin()` | `server/tenancy.ts` | Throws `403` unless `SUPER_ADMIN`. |
| `accessibleSet()` / `accessibleOrderScope()` | `server/tenancy.ts` | Computes the set of restaurants/branches a user may operate (explicit grants + owned + implied children). |
| `auth()` (rider) | `server/rider-auth.ts` | Drop-in for `/api/rider/*` + realtime: checks `Authorization: Bearer <JWT>` first (HS256, role re-checked against DB every request), falls back to NextAuth cookie. A bad Bearer token returns `null` (no cookie fallback). |
| `authorizeRealtimeChannel()` | `server/realtime-authz.ts` | Per-channel allow/deny for SSE + poll (deny-by-default). |
| Group `_helpers` | e.g. `admin/group/_helpers`, `admin/menu/import/_helpers`, `server/reports/admin-branch` | Thin wrappers (`requireActiveRestaurant`, `resolveBranchScope`, `requireOwnedItem`, `requireAdminBranch`) that all gate on a tenant membership before any DB work. |

### Role taxonomy

- **CUSTOMER** — storefront end-users. Phone-OTP or Google sign-in. Self-signup allowed unless `ALLOW_CUSTOMER_SELF_SIGNUP=false`.
- **ADMIN** — restaurant owner/manager. Email+password. Tenant-scoped to their restaurant(s); a parent-owner implicitly reaches child restaurants.
- **KITCHEN** — kitchen staff. Email+password. Tenant-scoped; narrower than ADMIN (no implied child cascade, fewer write surfaces).
- **RIDER** — delivery riders. Phone-OTP (web PWA) or Bearer JWT (native app). Scoped to their own `RiderProfile`/assignments.
- **SUPER_ADMIN** — platform operator. Email+password + (optional) TOTP + IP allowlist. Cross-tenant.
- **Public signed webhook** — no session; authenticity proven by HMAC signature over the raw body (Razorpay).
- **Public limited** — no auth required, but rate-limited and/or returns only non-sensitive data (health, storefront previews, location cookie).

> Conservative-marking convention: where role enforcement could not be confirmed by direct read, the cell reads **VERIFY**.

---

## `/api/auth/*`

| Route path | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation (Zod?) | Notes |
|---|---|---|---|---|---|---|---|
| `/api/auth/[...nextauth]` | GET, POST | Public (auth flow) | — | No | Internal (lockout in `authorize`) | n/a | NextAuth handler. Lockout, TOTP + IP allowlist for SUPER_ADMIN, single-active-session enforcement in JWT callback. |
| `/api/auth/otp` | POST | **Public limited** | — | No | **Yes** (`otp-send`, 10/min/IP) + per-phone limit in `sendOtp` | Yes | Sends customer/rider login OTP. |
| `/api/auth/restaurants` | GET | **Public limited** | — | No | No | n/a | Lists ACTIVE top-level restaurant name/slug for the staff-login picker. Only public storefront data. |

---

## `/api/admin/*` — ADMIN / KITCHEN, tenant-scoped (91 route files)

All admin routes are tenant-gated. Most check `auth()` + `role === 'ADMIN'` (or `['ADMIN','KITCHEN']`) inline and call `requireRestaurant()`; a subset use per-area `_helpers` (`requireActiveRestaurant`, `resolveBranchScope`, `requireOwnedItem`, `requireAdminBranch`) that wrap the same membership gate. Zod is present on virtually all mutating (POST/PATCH/PUT) handlers. None are public.

| Route group | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes (member paths) |
|---|---|---|---|---|---|---|---|
| Active restaurant switch | POST | Private | ADMIN/KITCHEN | Yes (validates membership before writing cookie) | No | Yes | `admin/active-restaurant` |
| Address tools | GET | Private | ADMIN | Yes | No | partial | `admin/addresses/reverse`, `admin/addresses/search` |
| Branches & pause | GET/POST/PATCH | Private | ADMIN | Yes | No | Yes | `admin/branches`, `admin/branch/[id]/pause`, `admin/branch/[id]/unpause`, `admin/settings/branch/[id]` |
| Menu CRUD | GET/POST/PATCH/DELETE | Private | ADMIN (KITCHEN read on some) | Yes (via `requireOwnedItem`/`resolveBranchScope`) | No | Yes | `admin/menu/categories`(+`[id]`,`/schedule`,`/toggle`), `admin/menu/items`(+`[id]`, `/schedule`, `/variants`(+`[variantId]`), `/modifier-groups`(+`[groupId]`,`/options`(+`[optionId]`)), `/bulk`) |
| Menu import/export | GET/POST | Private | ADMIN | Yes (`resolveBranchScope`) | No | file-parse | `admin/menu/export`, `admin/menu/template`, `admin/menu/import`, `admin/menu/import/apply` |
| Promotions | GET/POST/PATCH/DELETE | Private | ADMIN | Yes | No | Yes | `admin/coupons`(+`[id]`), `admin/coupon-campaigns`(+`[id]`,`/reports`), `admin/combos`(+`[id]`), `admin/offers`(+`[id]`,`/preview`), `admin/freebies`(+`[id]`), `admin/happy-hours`(+`[id]`,`/preview`), `admin/challenges`(+`[id]`,`/progress`), `admin/cross-sell`(+`[id]`) |
| Orders ops | GET/POST | Private | ADMIN/KITCHEN | Yes | No | Yes (`transition`, `assign`) | `admin/orders/[id]`(+`/assign`,`/auto-assign`,`/reassign`,`/suggest-riders`,`/transition`,`/feedback`,`/freebie`,`/invoice.pdf`,`/kot`), `admin/orders/snapshot` |
| Reports/exports | GET | Private | ADMIN | Yes (`requireAdminBranch`/`requireRestaurant`) | No | query-parse | `admin/reports/daily-sales`, `/item-sales`, `/payment-mode`, `/taxes`, `/delivery-fees`, `/cancelled-orders`, `/orders.csv`, `/orders.xlsx` |
| Riders/dispatch | GET/POST/PATCH | Private | ADMIN | Yes | No | Yes | `admin/riders`, `admin/dedicated-riders`(+`[id]`), `admin/dispatch-mode`, `admin/rider-safety`, `admin/rider-applications/[id]/approve`, `/reject` |
| Group management | GET/PATCH/POST/DELETE | Private | ADMIN (parent owner) | Yes (`requireActiveRestaurant`) | No | Yes | `admin/group`, `admin/group/access`, `admin/group/children`(+`[childId]`) |
| Integrations | GET/POST | Private | ADMIN | Yes | No | Yes | `admin/integrations`(+`[provider]`,`/test`) |
| Tables / reservations | GET/POST/PATCH/DELETE | Private | ADMIN | Yes | No | Yes | `admin/tables`(+`[id]`), `admin/reservations`(+`[id]`) |
| Messaging / notifications / feedback | GET/POST | Private | ADMIN | Yes | No | Yes | `admin/messages`(+`[id]`), `admin/notifications`, `admin/feedback`(+`/summary`) |
| Settings & branding | GET/POST/PATCH | Private | ADMIN | Yes | No | Yes | `admin/settings/branding`, `admin/settings/order-flow` |
| Upload | POST | Private | ADMIN/KITCHEN/SUPER_ADMIN | Yes (member check) | No | content-type + 8MB cap | `admin/upload` — multipart; allowed image MIME types only |
| Diagnostics | GET | Private | ADMIN/KITCHEN | Yes (`requireRestaurant`) | No | n/a | `admin/diag/sync` — exposes recent-order + SSE subscriber counts for the caller's branch only |

---

## `/api/platform/*` — SUPER_ADMIN only (76 route files)

Every platform route enforces `requireSuperAdmin()` (or an inline `SUPER_ADMIN` role check). Cross-tenant by design. Three "job" endpoints additionally accept an internal-cron secret header.

| Route group | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes (member paths) |
|---|---|---|---|---|---|---|---|
| Restaurants lifecycle | GET/POST/PATCH | Private | SUPER_ADMIN | No (platform-wide) | No | Yes | `platform/restaurants/[id]`(+`/approve`,`/reject`,`/suspend`,`/parent`,`/qr`), `platform/restaurants/groups`, `platform/restaurants/wizard` |
| Brands | GET/POST/PATCH | Private | SUPER_ADMIN | No | No | Yes | `platform/brands`(+`[id]`,`/reports`,`/restaurants`(+`[restaurantId]`)) |
| Users | GET/PATCH | Private | SUPER_ADMIN | No | No | Yes | `platform/users/[id]` — full PII bundle (orders, wallet, addresses), wallet adjustments |
| Payouts / COD / payments | GET/POST/PATCH | Private | SUPER_ADMIN | No | No | Yes | `platform/payouts`(+`/preview`), `platform/cod`(+`[id]/mark-collected`,`/mark-mismatch`,`/reconcile`,`/waive`), `platform/rider-payouts`(+`[id]`) |
| Riders (ops) | GET/POST/PATCH | Private | SUPER_ADMIN | No | No | Yes | `platform/riders/[id]`(+`/active-order`,`/dispatch`,`/payout-override`(+`/preview`),`/recent-pings`), `platform/riders/live`, `platform/rider-applications/[id]/approve`,`/reject`, `platform/rider-incentives`(+`[id]`), `platform/rider-incidents`(+`[id]`), `platform/rider-referrals`, `platform/rider-shifts`, `platform/rider-sos`(+`[id]`), `platform/rider-support`(+`[id]`), `platform/rider-tiers` |
| KYC | GET/POST/PATCH | Private | SUPER_ADMIN | No | No | Yes | `platform/kyc`(+`[id]`) |
| Reports | GET | Private | SUPER_ADMIN | No | No | query-parse | `platform/reports/gmv-by-day`, `/restaurant-sales`, `/rider-earnings`, `/cancellations`, `/cod-pending`, `/delayed-orders`, `/payment-mode-split` |
| Live-ops / escalations | GET/POST | Private | SUPER_ADMIN (+cron secret on `scan`) | No | No | partial | `platform/escalations/[id]/acknowledge`,`/resolve`, `platform/escalations/scan`, `platform/orders/[id]`, `platform/discovery-radius`, `platform/surge-zones`(+`[id]`) |
| Cron jobs | POST | Private | SUPER_ADMIN **OR** `x-internal-secret` == `INTERNAL_CRON_SECRET` | No | No | n/a | `platform/jobs/kyc-expiry/run`, `platform/rider-heartbeat/sweep`, `platform/escalations/scan` |
| Security | GET/POST | Private | SUPER_ADMIN | No | No | Yes | `platform/security`, `platform/security/totp/setup`, `platform/security/totp/verify` |
| Signup bonus | GET/POST | Private | SUPER_ADMIN | No | No | Yes | `platform/signup-bonus`, `/grants`, `/grants/[id]/revoke` |
| Support / messages / feedback / audit / training | GET/POST/PATCH | Private | SUPER_ADMIN | No | No | Yes | `platform/support`(+`[id]`), `platform/messages`(+`[id]`), `platform/feedback`(+`/summary`), `platform/audit-log`, `platform/training-modules`(+`[id]`) |

---

## `/api/rider/*` — RIDER (Bearer JWT or cookie) (~55 route files)

All `/api/rider/*` handlers import `auth()` from `server/rider-auth.ts` and check `role === 'RIDER'`. Scoped to the caller's own `RiderProfile`/assignments. The two `rider/auth/*` endpoints are the unauthenticated login step and are rate-limited.

| Route group | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes (member paths) |
|---|---|---|---|---|---|---|---|
| Rider login | POST | **Public limited** | — | No | **Yes** (`rider-otp-send` 10/min; verify-otp also limited) | Yes | `rider/auth/request-otp` (rider-phone-only gate, vague 404), `rider/auth/verify-otp` (issues Bearer JWT) |
| Assignments | GET/POST | Private | RIDER (own) | Self (RiderProfile) | No | Yes (on actions) | `rider/assignments`, `rider/assignments/[id]/accept`,`/pickup`,`/deliver`,`/fail`,`/photo`,`/reach-customer`,`/reach-restaurant`,`/customer-unreachable` |
| Pool / batches | GET/POST | Private | RIDER | Self | No | Yes | `rider/pool`, `rider/pool/[orderId]/claim`, `rider/batch-invitations`(+`[id]/accept`,`/decline`) |
| Presence / location | POST | Private | RIDER | Self | No | Yes | `rider/heartbeat`, `rider/online`, `rider/location`, `rider/push-token`, `rider/trip-share` |
| Earnings / payouts / incentives | GET | Private | RIDER | Self | No | n/a | `rider/earnings`, `rider/payouts`, `rider/incentives`, `rider/surge`, `rider/tier`, `rider/referrals`, `rider/reports/statement`, `rider/cod`, `rider/heatmap` |
| Profile / KYC | GET/POST/PATCH | Private | RIDER | Self | No | Yes | `rider/profile`(+`/preview-verify`), `rider/me`, `rider/avatar`, `rider/preferences`, `rider/kyc`(+`[id]`,`/reverify`), `rider/emergency-contacts`(+`[id]`) |
| Shifts / training | GET/POST | Private | RIDER | Self | No | Yes | `rider/shifts`(+`[id]`), `rider/training`(+`[id]`) |
| Messages / feedback / support / SOS / incidents | GET/POST | Private | RIDER | Self | No | Yes | `rider/messages`(+`[id]`), `rider/feedback`, `rider/support`(+`[id]`), `rider/sos`(+`[id]/resolve`), `rider/incidents` |

---

## `/api/customer/*` — CUSTOMER (signed-in) + a few public reads (~28 route files)

Most check `auth()` (signed-in user; ownership enforced by matching `userId`/`customerId`). A few storefront reads are deliberately public.

| Route group | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes (member paths) |
|---|---|---|---|---|---|---|---|
| Profile | GET | Private | Any signed-in (`me` not role-gated) | Self | No | n/a | `customer/me`, `customer/me/[slug]` — page enforces CUSTOMER; route allows any signed-in user to read own profile |
| Addresses | GET/POST/PATCH/DELETE | Private | signed-in | Self (`userId`) | No | Yes | `customer/addresses`(+`[id]`,`/default`), `customer/addresses/reverse`, `/search` |
| Orders/feedback/reorder | GET/POST/PATCH | Private | signed-in (owner check) | Self (`customerId`) | No | Yes | `customer/orders/[id]/feedback`, `customer/recent-orders`, `customer/reorder/[orderId]`, `customer/feedback/pending` |
| Rewards / offers / bonus | GET/POST | Private | signed-in | Self | No | Yes | `customer/rewards`, `customer/offers/eligible`, `customer/offers/apply-code`, `customer/signup-bonus`(+`/preview`), `customer/challenges` |
| Favorites / sessions | GET/POST/DELETE | Private | signed-in | Self | No | Yes | `customer/favorites/items`, `/restaurants`, `customer/sessions/[id]`, `customer/sessions/terminate-others` |
| Cross-sell | GET/POST | signed-in (cart read) | signed-in | Self | No | Yes | `customer/cross-sell`, `customer/cross-sell/cart` |
| **Public reads** | GET/POST | **Public limited** | — | No | No | Yes (body) | `customer/delivery-eta` (anonymous ETA preview), `customer/happy-hours` (public promo info), `customer/location` (sets non-httpOnly location cookie — guests allowed) |

---

## `/api/orders/*` and `/api/checkout/*` and `/api/delivery/*`

| Route path | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes |
|---|---|---|---|---|---|---|---|
| `/api/orders` | POST | Private | signed-in | order tied to `customerId` | No | Yes | Place order. Server re-prices from IDs; client prices never trusted. |
| `/api/orders/[id]/items` | GET | Private | signed-in (owner) | Self | No | n/a | 404 unless `order.customerId == user.id`. |
| `/api/orders/[id]/confirm-mock-payment` | POST | Private | signed-in (owner) | Self | No | n/a | Owner-only; only flips a `mock`-provider PENDING payment. Dev/test path — see follow-ups. |
| `/api/orders/[id]/location` | GET | Private | signed-in | owner OR ADMIN/KITCHEN/RIDER | No | n/a | CUSTOMER limited to own order; staff/rider scoping noted as "done elsewhere" — see **VERIFY**. |
| `/api/orders/[id]/tip` | POST | Private | signed-in (owner) | Self | No | Yes | Owner-only; adds rider tip. |
| `/api/orders/lookup` | GET | **Public limited** | — | No | **Yes** (`order-lookup` 30/min) | n/a (query) | Resolves order **code → id** with no auth. Rate-limited against enumeration. Returns only `{ id }`. See **business-owner confirmation**. |
| `/api/checkout/quote` | POST | **Public** | — | No | No | Yes | Cart pricing preview, no auth. Reads menu/coupon by id. |
| `/api/checkout/validate-address` | POST | **Public** | — | No | No | Yes | Service-zone check; unauthenticated by design (guest cart). |
| `/api/delivery/calculate-fee` | POST | **Public** | — | No | No | Yes | Distance fee preview, no auth. |
| `/api/delivery/eta/[orderId]` | GET | signed-in | signed-in | partial | No | n/a | Imports `auth()`; ETA for an in-flight order — confirm owner/role scoping. **VERIFY**. |

---

## `/api/payments/*` — webhooks + verification

| Route path | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes |
|---|---|---|---|---|---|---|---|
| `/api/payments/razorpay/webhook` | POST | **Public signed webhook** | — | n/a | No | HMAC-verified | HMAC-SHA256 over raw body vs `RAZORPAY_WEBHOOK_SECRET`; idempotent via `PaymentWebhookEvent`; raw payload persisted before business logic. |
| `/api/payments/webhook` | POST | **Public signed webhook** | — | n/a | No | HMAC-verified (if secret set) | Older/duplicate Razorpay receiver. **NOTE:** if `RAZORPAY_WEBHOOK_SECRET` is unset the signature check is SKIPPED — see Known gaps. |
| `/api/payments/verify` | POST | **Public limited** | — | order's tenant creds | **Yes** (`payment-verify` 30/min) | Yes | Client-side Razorpay verify callback. Verifies signature via tenant provider; no session (called from checkout). |

---

## `/api/r/[slug]/*` and `/api/qr/*` — storefront / table-QR

| Route path | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes |
|---|---|---|---|---|---|---|---|
| `/api/r/[slug]/freebies` | GET | **Public** | — | by slug (server-resolved) | No | n/a (query) | Storefront freebie nudge. Branch resolved from slug; never accepts client `branchId`. |
| `/api/r/[slug]/reservations` | GET/POST | Private | CUSTOMER | by slug | No | Yes | Must be signed-in CUSTOMER; lists/creates own reservations at the slug's branch. |
| `/api/r/[slug]/reservations/availability` | GET | **Public** | — | by slug | No | query | Open availability lookup for the booking widget. |
| `/api/qr/[code]/resolve` | GET | **Public limited** | — | by code | **Yes** (`qr-resolve` 60/min) | n/a | Resolves QR code → storefront redirect; increments scan count; 404 on inactive. |

---

## Signup, events, health, misc

| Route path | Method(s) | Public/Private | Required role | Tenant-scoped? | Rate limit | Validation | Notes |
|---|---|---|---|---|---|---|---|
| `/api/signup/restaurant` | POST | **Public limited** | — | No | **Yes** | Yes | Self-serve restaurant onboarding; argon2-hashes owner password. |
| `/api/signup/rider` | POST | **Public limited** | — | No | **Yes** (`signup-rider` 5/10min) | Yes | Rider application; dedupes by phone. |
| `/api/events` | GET | Private | any signed-in, **per-channel authorized** | per-channel (`authorizeRealtimeChannel`) | No | n/a | SSE bus. Uses rider-aware `auth()`; deny-by-default channel authz. |
| `/api/events/poll` | GET | Private | any signed-in, **per-channel authorized** | per-channel | No | n/a | Polling fallback — same authz gate as SSE (not a backdoor). |
| `/api/health` | GET | **Public limited** | — | No | No (trivial) | n/a | Liveness `{ ok, time }`. No DB. |
| `/api/ready` | GET | **Public limited** | — | No | No | n/a | Readiness — runs `SELECT 1`; 503 on DB failure. |
| `/api/system/health` | GET | **Public limited** | — | No | **Yes** (in-process 30/min/IP) | n/a | Health for monitors; throttled to prevent DB-fingerprinting. |
| `/api/app-version` | GET | **Public** | — | No | No | query | App force-update gate; no sensitive data. |
| `/api/me` | GET | signed-in (returns `{role:null}` if not) | any | No | No | n/a | Returns own session identity. |
| `/api/me/restaurants` | GET | signed-in | any | Self memberships | No | n/a | Lists caller's restaurant memberships (login routing). |
| `/api/addresses`, `/api/addresses/[id]` | POST/GET/PATCH/DELETE | Private | signed-in | Self (`userId`) | No | Yes | Customer addresses (non-tenant-prefixed twin of `customer/addresses`). |
| `/api/support/tickets` | POST | Private | signed-in (any role) | role-derived owner | **Yes** (`support-tickets` 10/10min) | Yes | Ties ticket to rider/restaurant/customer by role. |
| `/api/kitchen/orders` | GET | Private | ADMIN/KITCHEN | Yes (`requireRestaurant` + `accessibleOrderScope`) | No | n/a | Kitchen board snapshot/safety-net poll. |

---

## Routes needing business-owner confirmation

These are functionally public or have non-obvious scoping. Confirm the intent before treating them as safe:

1. **`/api/orders/lookup` (GET, public, rate-limited).** Anyone can resolve an order **code → internal id** with no auth — by design for guest order tracking. Confirm: (a) the resulting `id` only unlocks owner-gated detail endpoints (`orders/[id]/items` etc. do check ownership), and (b) order codes are not trivially guessable. The rate limit (30/min) mitigates enumeration but does not eliminate it.
2. **`/api/orders/[id]/location` (GET).** CUSTOMER access is owner-gated, but for ADMIN/KITCHEN/RIDER the comment says scoping is "done elsewhere" — the handler itself does **not** verify the staff/rider belongs to the order's restaurant/assignment. Confirm whether an ADMIN of restaurant A can read live location for an order at restaurant B. Marked **VERIFY**.
3. **`/api/delivery/eta/[orderId]` (GET).** Imports `auth()` but the read portion (only first ~22 lines reviewed) needs confirmation that it enforces order ownership/role. Marked **VERIFY**.
4. **`/api/customer/location` (POST/DELETE).** Sets a deliberately **non-httpOnly** cookie (client header reads it). Holds only a coarse user-chosen location — confirm that's acceptable and that nothing sensitive is ever stored in it.
5. **`/api/checkout/quote`, `/api/checkout/validate-address`, `/api/delivery/calculate-fee` (public).** All read menu/branch/coupon data with no auth and no rate limit. Confirm these are acceptable as public (they are storefront previews; server re-prices on real order placement). Consider whether coupon-code probing via `quote` warrants rate limiting.
6. **`/api/r/[slug]/reservations/availability` & `/api/r/[slug]/freebies` (public).** Expose per-branch availability/freebie info without auth — intended for the storefront, confirm no sensitive capacity/financial data leaks.
7. **`/api/orders/[id]/confirm-mock-payment` (POST).** A customer can self-confirm a `mock`-provider payment. Confirm this path is disabled/unreachable in production (only acts on `providerName === 'mock'`).

## Known gaps / follow-ups

1. **Duplicate Razorpay webhook with optional signature.** `/api/payments/webhook` only verifies the HMAC **if `RAZORPAY_WEBHOOK_SECRET` is set** (`if (secret) {...}`) — an unset env var silently disables verification, making it forgeable. It is also redundant with the hardened `/api/payments/razorpay/webhook`. Recommend removing `/api/payments/webhook` or making the secret mandatory (fail closed).
2. **Rate limiting is sparse.** Only 10 route files use the shared `rateLimit()` helper (`auth/otp`, `orders/lookup`, `payments/verify`, `rider/auth/*`, `signup/*`, `qr/[code]/resolve`, `support/tickets`) plus the in-process limiter in `system/health`. Notable un-limited public/expensive endpoints: `checkout/quote`, `checkout/validate-address`, `delivery/calculate-fee`, `customer/delivery-eta`, `r/[slug]/reservations/availability`, `auth/restaurants`. Task brief notes "a few others may be in progress" — confirm the in-progress list.
3. **API routes are not covered by the middleware role gates** (matcher is page-prefix only). Security depends entirely on each handler calling the right helper. A new route that forgets the gate is silently public — recommend a lint rule or a `withAuth` wrapper convention. The two report exports (`orders.csv`/`orders.xlsx`) and a few `_helpers`-based admin routes were confirmed gated, but every future route is at risk.
4. **`/api/me` and `/api/customer/me` are not role-gated** — any signed-in user (including RIDER/KITCHEN) can read their own profile bundle there. Acceptable for self-data, but confirm `customer/me/[slug]` does not leak tenant data to non-customers.
5. **Cron-job endpoints accept a static shared secret** (`x-internal-secret == INTERNAL_CRON_SECRET`) on `platform/jobs/kyc-expiry/run`, `platform/rider-heartbeat/sweep`, `platform/escalations/scan`. Confirm the secret is strong, rotated, and only sent over TLS; consider IP-allowlisting the cron source.
6. **Spot-check coverage.** ~25 of 279 route files were read in full; the rest were classified from per-group conventions, shared `_helpers`, and import analysis (every admin/platform/rider/customer file was grep-checked for an auth import). Routes left as **VERIFY** above should be read line-by-line before any security sign-off.
