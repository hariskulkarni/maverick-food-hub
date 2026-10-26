# Flavrly — Multi-Tenant Food Ordering System & Delivery Platform

[![CI](https://github.com/hariskulkarni/maverick-food-hub/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hariskulkarni/maverick-food-hub/actions/workflows/ci.yml)
[![CodeQL](https://github.com/hariskulkarni/maverick-food-hub/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/hariskulkarni/maverick-food-hub/actions/workflows/codeql.yml)
![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![Prisma](https://img.shields.io/badge/Prisma-5.22-2D3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15%2B-4169E1?logo=postgresql)
![Expo](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo)
![Node](https://img.shields.io/badge/Node-20%20LTS-5FA04E?logo=nodedotjs)

Flavrly is a production-grade, self-hostable food ordering and delivery platform built for the Indian market. One Next.js deployment serves the customer storefront, restaurant admin, kitchen, super-admin platform and a rider web portal; a native Android app (Expo / React Native) serves delivery riders. Many independent restaurants — and parent/child restaurant groups — run side by side on one database with strict tenant isolation.

> **White-label:** the brand name comes from `NEXT_PUBLIC_BRAND_NAME` (default `Flavrly`).

---

## Contents

- [At a glance](#at-a-glance)
- [Overview](#overview)
- [Highlights](#highlights)
- [Surfaces](#surfaces)
- [Features by surface](#features-by-surface)
- [Architecture](#architecture)
- [Multi-tenancy model](#multi-tenancy-model)
- [Order lifecycle](#order-lifecycle)
- [Payments](#payments)
- [Realtime](#realtime)
- [Security model](#security-model)
- [Tech stack](#tech-stack)
- [Codebase charts](#codebase-charts)
- [Testing and CI](#testing-and-ci)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Deployment](#deployment)
- [Environment variables](#environment-variables)
- [Diagram gallery](#diagram-gallery)
- [Further docs](#further-docs)

---

## At a glance

| Metric | Count |
|---|---|
| Web pages (`page.tsx`) | **167** — customer 47 · admin 51 · platform 51 · rider web 10 · kitchen 5 · other 3 |
| API route handlers (`/api/**/route.ts`) | **468** |
| Data model | **152** Prisma models · **89** enums · **33** migrations |
| Server modules (`apps/web/src/server`) | **279** |
| Source size | ~**164k** lines of TypeScript (web) · ~**14k** (rider app) |
| Unit / integration tests | **2,529** passing tests in **274** files (Vitest) |
| Real-PostgreSQL tests | **238** tests in **24** files (`npm run test:db`) |
| End-to-end specs | **24** Playwright specs |

---

## Overview

Each restaurant is a **tenant** with its own branches, menu, staff, riders, offers and settings. Restaurants can be grouped **parent → child**: a parent operates the whole group (orders, riders, reports) from one dashboard with an account switcher. A platform super-admin oversees the network: approvals, commissions, payouts, rider operations, KYC and observability.

Customers discover nearby restaurants, order for **delivery, self-pickup or dine-in** (now or scheduled), pay online (PhonePe, Razorpay) or cash on delivery with wallet and loyalty, and track the order live — including the rider on a map and a delivery OTP. Kitchen staff work a live order board; riders work from the native Android app or the rider web portal.

Production serves two hostnames from one deployment: **`flavrly.in`** for customers and **`portal.flavrly.in`** for staff (admin, kitchen, platform). Middleware enforces which surface each host serves.

---

## Highlights

- **Server-authoritative pricing** — variants, modifiers, happy hours, offers, coupons, freebies, wallet, loyalty and signup bonus are resolved on the server at order time; the cart never dictates price.
- **Strict order state machine** — 22 statuses with an explicit transition table, failure and recovery paths, stuck-order escalation and refunds.
- **Payment safety** — online orders start in `PAYMENT_PENDING` (hidden from the kitchen) and move to `RECEIVED` only after verified capture; unpaid orders fail at 30 minutes and cancel (benefits returned) after 24 hours.
- **Realtime everywhere** — Server-Sent Events with a polling and snapshot safety net, so an order never stays invisible if a stream drops.
- **Google reviews suite** — policy-compliant review requests (no gating, no incentives), reply drafting with a safety filter, negative-review alerts, insights and a weekly digest.
- **Operator tooling** — 10-step restaurant onboarding wizard with a go-live readiness gate, training library with quizzes and certificates, help center with full-text search, observability center and dispatch insights.
- **Rider operations** — KYC verification and gate, incentives, tiers, referrals, shifts, SOS, payouts, and app releases with an in-app update prompt.
- **Defence in depth** — tenant-scoped data access, TOTP for staff, IP allowlist for super-admins, CSRF and rate limiting in middleware, CodeQL `security-extended`, gitleaks and dependency audit in CI.
- **Flavrly PG (direct UPI) — built, switched off** — a self-hosted UPI gateway integration that marks money captured only from matching bank evidence. It is **not activated in production** and holds no bank, NPCI or RBI approval; see [`docs/flavrly-pg/FINAL_GO_NO_GO.md`](docs/flavrly-pg/FINAL_GO_NO_GO.md).

---

## Surfaces

| Surface | Host | Path / app | Sign-in |
|---|---|---|---|
| Public storefront and discovery | `flavrly.in` | `/`, `/restaurants`, `/r/[slug]` | none to browse |
| Customer | `flavrly.in` | `/r/[slug]`, `/cart`, `/checkout`, `/orders`, `/profile` | phone OTP or Google |
| Restaurant admin | `portal.flavrly.in` | `/admin` | email + password (membership role `ADMIN`) |
| Kitchen | `portal.flavrly.in` | `/kitchen` | email + password (membership role `KITCHEN`) |
| Super-admin platform | `portal.flavrly.in` | `/platform` | email + password + TOTP, optional IP allowlist; delegated roles (Admin Assist, Developer, QA, Guest) see only the areas they are granted |
| Rider web portal | web | `/rider` (dashboard, earnings, KYC, shifts, training, help, profile) | rider session |
| Rider app | Android | `apps/rider-native` (Expo) | phone OTP, bearer token |

One `/login` page routes each user to the right surface after sign-in.

---

## Features by surface

### Customer
- Location-first discovery (delivery-radius filter, cuisine chips, sorting) and a CMS-driven discovery page
- Menus with variants/sizes, modifier groups, happy-hour pricing and scheduled category availability
- Delivery, self-pickup, dine-in and scheduled orders; table reservations with optional deposit
- PhonePe and Razorpay online payment, COD, wallet, loyalty points, signup bonus, auto-applied offers and coupons
- Live tracking: status timeline, rider location on a map, delivery OTP, and "Pay now" on the tracker for pending payments
- Saved addresses with map picker, reorder, favourites, ratings and feedback, delivery ETA preview

### Restaurant admin (`/admin`)
- Live orders and kitchen board, KOT and invoices; KOT refuses unpaid orders
- Menu management with bulk CSV/Excel import and export, variants, modifiers, images and scheduling
- Offers, coupons, coupon campaigns, combos, happy hours, challenges, cross-sell, freebies
- Dine-in tables and reservations; order-flow toggles (auto-accept, scheduled, pickup, dine-in); delivery zones
- Riders, rider safety, messaging, reports and analytics, activity log, storefront settings
- **Onboarding wizard** (`/admin/onboarding`): 10 resumable steps with FSSAI/GSTIN/PAN validation, cuisine templates or CSV menu import, delivery presets and a server-checked go-live gate
- **Google reviews** (`/admin/reviews`): review requests by SMS/WhatsApp/email, QR review kit, service-recovery tickets, reply drafting with a safety filter, insights
- Training (`/admin/training`) and help center (`/admin/help`); restaurant groups with a unified parent dashboard

### Kitchen (`/kitchen`)
- New → Accepted → Preparing → Ready board with order chimes, plus training and help

### Super-admin platform (`/platform`)
- Network dashboard, restaurants, orders, users, live ops, live tracking, approvals, brands, IAM
- COD reconciliation, settlements, payouts, rider pay, payment-gateway configuration, signup bonus
- Riders: KYC review, incentives, tiers, referrals, shifts, SOS, incidents, support, rider settings (KYC gate)
- **Observability center**, system health, audit log, security settings (TOTP, IP allowlist, lockout)
- Dispatch insights, surge zones, discovery CMS, reviews analytics, help authoring, training authoring
- App releases for the rider APK, with a download page and in-app update prompt
- Flavrly PG accounts and operations consoles (`/platform/youpi/*`), inactive while the feature flag is off

### Rider (native app and `/rider` web portal)
- Phone-OTP login, online/offline with heartbeat, order pool with self-claim, batch dispatch
- Pickup → delivery flow with Google Maps navigation, background GPS, delivery-OTP check and photo proof
- Earnings, payouts, KYC documents, shifts, training with quizzes and certificates, help with offline cache

---

## Architecture

```mermaid
flowchart TB
  subgraph Clients
    C["Customer web<br/>flavrly.in"]
    S["Staff web<br/>portal.flavrly.in"]
    RW["Rider web portal<br/>/rider"]
    RA["Rider Android app<br/>Expo / React Native"]
  end

  subgraph VPS["VPS: nginx + PM2"]
    NG["nginx<br/>TLS, reverse proxy"]
    subgraph APP["Next.js 15 app: rm-web"]
      MW["Middleware<br/>host split, auth gates, CSRF, rate limits"]
      RSC["Server Components<br/>and Server Actions"]
      API["REST API /api/*<br/>and SSE /api/events"]
      DOM["Domain modules src/server<br/>tenancy, orders, pricing, payments,<br/>dispatch, reviews, training, help"]
      BUS["In-process event bus<br/>SSE fan-out"]
    end
    JOBS["Cron jobs<br/>POST /api/platform/jobs/*"]
    PG[("PostgreSQL<br/>Prisma 5")]
    GW["youpi-pg<br/>self-hosted UPI gateway<br/>Flavrly PG, flag off"]
  end

  subgraph External
    PAY["PhonePe, Razorpay"]
    MSG["2Factor SMS, WhatsApp,<br/>email, web push, Expo push"]
    GOO["Google OAuth,<br/>Business Profile"]
    MAP["OpenStreetMap / Leaflet"]
    OBJ["Local or S3 storage"]
  end

  C --> NG
  S --> NG
  RW --> NG
  RA -->|bearer token| NG
  NG --> MW
  MW --> RSC
  MW --> API
  RSC --> DOM
  API --> DOM
  DOM --> PG
  DOM --> BUS
  BUS --> API
  JOBS --> API
  DOM --> PAY
  DOM --> MSG
  DOM --> GOO
  DOM --> OBJ
  C -.-> MAP
  DOM -.-> GW
```

- **One app, many surfaces** — route groups `(customer)`, `admin`, `kitchen`, `platform` and `rider` share one Prisma schema and one set of domain modules in `apps/web/src/server`.
- **Adapters** — payments, SMS/WhatsApp, storage, maps and push sit behind narrow interfaces with mock implementations for local development.
- **Jobs** — review requests and digests, dispatch statistics, observability alerts and retention, escalations, rider heartbeat and the Flavrly PG worker run as POST-only cron routes protected by a constant-time secret check ([`deploy/flavrly-jobs.cron`](deploy/flavrly-jobs.cron)).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/ARCHITECTURE-V2.md`](docs/ARCHITECTURE-V2.md) for the deep dive.

---

## Multi-tenancy model

```mermaid
erDiagram
  Restaurant ||--o{ Restaurant : "parent of"
  Brand ||--o{ Restaurant : groups
  Restaurant ||--o{ Branch : has
  Restaurant ||--o{ RestaurantUser : "staff memberships"
  User ||--o{ RestaurantUser : "member of"
  Branch ||--o{ Category : has
  Category ||--o{ MenuItem : contains
  Branch ||--o{ Order : receives
  User ||--o{ Order : places
  Order ||--o{ OrderItem : contains
  Order ||--o{ Payment : "paid by"
  Order ||--o| RiderAssignment : "delivered via"
  RiderProfile ||--o{ RiderAssignment : takes
  User ||--o| RiderProfile : "rider profile"
```

- Staff permissions come from the **membership role** in `RestaurantUser` (ADMIN or KITCHEN), never the global user role — a global admin holding only a kitchen grant is kitchen there (`src/server/tenancy.ts`).
- The active restaurant is chosen with an account-switcher cookie that is honoured only for restaurants the user can access.
- `Restaurant.parentId` forms groups; `src/server/group-scope.ts` resolves every restaurant and branch a parent operates.

---

## Order lifecycle

The transition table lives in `apps/web/src/server/orders.ts`; any other move is rejected.

```mermaid
stateDiagram-v2
  [*] --> PAYMENT_PENDING: online payment
  [*] --> RECEIVED: COD or wallet
  PAYMENT_PENDING --> RECEIVED: verified capture
  PAYMENT_PENDING --> PAYMENT_FAILED
  PAYMENT_FAILED --> RECEIVED: retry captured
  RECEIVED --> ACCEPTED
  ACCEPTED --> PREPARING
  PREPARING --> READY
  READY --> RIDER_ASSIGNED
  READY --> DELIVERED: pickup or dine-in
  RIDER_ASSIGNED --> RIDER_REACHED_RESTAURANT
  RIDER_REACHED_RESTAURANT --> PICKED_UP
  PICKED_UP --> OUT_FOR_DELIVERY
  OUT_FOR_DELIVERY --> RIDER_REACHED_CUSTOMER
  RIDER_REACHED_CUSTOMER --> DELIVERED: OTP verified
  RIDER_REACHED_CUSTOMER --> DELIVERY_OTP_FAILED
  RIDER_REACHED_CUSTOMER --> CUSTOMER_UNREACHABLE
  DELIVERY_OTP_FAILED --> DELIVERED
  CUSTOMER_UNREACHABLE --> DELIVERED
  DELIVERY_OTP_FAILED --> DELIVERY_FAILED
  CUSTOMER_UNREACHABLE --> DELIVERY_FAILED
  PICKED_UP --> DELIVERY_FAILED
  RECEIVED --> CANCELLED_BY_CUSTOMER
  RECEIVED --> CANCELLED_BY_RESTAURANT
  PREPARING --> CANCELLED_BY_ADMIN
  DELIVERY_FAILED --> REFUND_PENDING
  DELIVERED --> REFUND_PENDING
  CANCELLED_BY_CUSTOMER --> REFUND_PENDING
  CANCELLED_BY_RESTAURANT --> REFUND_PENDING
  CANCELLED_BY_ADMIN --> REFUND_PENDING
  REFUND_PENDING --> REFUND_INITIATED
  REFUND_PENDING --> REFUNDED
  REFUND_INITIATED --> REFUNDED
  DELIVERED --> [*]
  REFUNDED --> [*]
```

Simplified for readability: admins can also cancel from most pre-delivery states, and `READY` / `RIDER_ASSIGNED` may move straight to `OUT_FOR_DELIVERY`. The table in `orders.ts` is the full set.

---

## Payments

### Online gateways (PhonePe, Razorpay)

```mermaid
sequenceDiagram
  autonumber
  actor Cu as Customer
  participant App as Flavrly API
  participant DB as PostgreSQL
  participant GW as PhonePe / Razorpay
  participant K as Kitchen board
  Cu->>App: POST /api/orders (cart, payment method)
  App->>App: price on server (offers, wallet, loyalty)
  App->>DB: create Order as PAYMENT_PENDING
  App-->>Cu: checkout session
  Cu->>GW: pay
  GW-->>App: authenticated webhook or status check
  App->>GW: verify payment status or signature
  App->>DB: Payment CAPTURED, Order to RECEIVED
  App-->>K: SSE order event, now visible
  Note over App,DB: Unpaid sweep fails the order after 30 min and cancels it with benefits returned after 24 h
```

Cash-on-delivery orders and fully wallet-paid (zero-total) orders go straight to `RECEIVED`; COD cash is reconciled per rider on the platform.

### Flavrly PG (direct UPI) — capture only from bank evidence

Engineering complete, **switched off in production** (`FLAVRLY_PG_NEW_PAYMENTS_ENABLED` unset). A gateway "success" is treated as an observation, not as money received.

```mermaid
sequenceDiagram
  autonumber
  participant App as Flavrly
  participant GW as youpi-pg gateway
  participant Bank as Bank evidence
  participant Rec as allocateBankCredit
  App->>GW: create attempt for a verified receiving account
  GW-->>App: webhook SUCCESS with UTR, HMAC checked, stored before 200
  App->>App: record evidence only, order stays PAYMENT_PENDING
  Bank->>Rec: credit line from statement import or dual-control entry
  Rec->>Rec: match account, exact paise, UTR and time window under row lock
  Rec->>App: Payment CAPTURED, outbox ORDER_RELEASE
  App->>App: Order to RECEIVED
  Note over Rec: Overcollection, late payment or ambiguity go to the exception queue, never a second release
```

Details: [`docs/flavrly-pg/ARCHITECTURE_AND_DATA_FLOWS.md`](docs/flavrly-pg/ARCHITECTURE_AND_DATA_FLOWS.md), [`docs/flavrly-pg/FINANCIAL_INVARIANTS.md`](docs/flavrly-pg/FINANCIAL_INVARIANTS.md).

---

## Realtime

```mermaid
sequenceDiagram
  participant Board as Kitchen or admin board
  participant SSE as GET /api/events
  participant Bus as Event bus
  participant Ord as Order service
  Board->>SSE: open stream for branch, group or order channels
  Ord->>Bus: publish status change or rider location
  Bus-->>SSE: fan-out
  SSE-->>Board: event
  loop every 15 s and on tab focus
    Board->>SSE: snapshot poll as safety net
  end
```

The bus lives in `apps/web/src/server/realtime.ts`; clients fall back to `/api/events/poll`.

---

## Security model

| Area | Control |
|---|---|
| Tenant isolation | Admin and kitchen data access scoped through `tenancy.ts` membership roles; caller-supplied ids re-checked on the server |
| Authentication | NextAuth v5; Argon2id passwords; phone OTP with attempt limits; single active session per user; login history |
| Staff 2FA | TOTP for super-admins and platform roles with recovery codes; optional IP allowlist and lockout (`src/server/2fa.ts`) |
| Request hygiene | Host-split middleware, `Sec-Fetch-Site: cross-site` CSRF block, per-IP / per-user / auth-path rate limits with backoff |
| Webhooks and jobs | Signature or HMAC verification, exact webhook path allowlist, POST-only cron routes with a constant-time secret |
| Money | Server-side pricing, `PAYMENT_PENDING` gating, atomic wallet and points debits, bank-evidence-only capture for Flavrly PG |
| Supply chain | CodeQL `security-extended` on every PR, gitleaks secret scan, `npm audit` gate, SHA-pinned GitHub Actions |
| Data | KYC files in private storage, no PII in order logs, pinned VPS host key for deploys |

Payments threat model: [`docs/flavrly-pg/SECURITY_THREAT_MODEL.md`](docs/flavrly-pg/SECURITY_THREAT_MODEL.md).

---

## Tech stack

| Layer | Technology |
|---|---|
| Web framework | Next.js 15.5 (App Router), React 19, TypeScript |
| UI | Tailwind CSS 3.4, shadcn-style components, lucide-react, Recharts, Sonner |
| Data | PostgreSQL 15+, Prisma 5.22 (`prisma migrate deploy`) |
| Validation | zod 4 |
| Auth | NextAuth v5 (beta.32), Argon2id, otplib (TOTP) |
| Realtime | Server-Sent Events over an in-process event bus |
| Payments | PhonePe Standard Checkout, Razorpay, COD, wallet and loyalty; Flavrly PG direct UPI (off) |
| Messaging | 2Factor SMS/OTP, Meta WhatsApp, email (nodemailer), web push, Expo push |
| Maps | Leaflet + OpenStreetMap (web), react-native-maps with Google Maps navigation (rider) |
| Files | Local or S3-compatible storage, sharp, ExcelJS |
| Logging | pino |
| Rider app | Expo SDK 54, React Native 0.81, expo-router, expo-location, EAS Build |
| Testing | Vitest, Playwright, real-PostgreSQL integration suite |
| Hosting | VPS, nginx, PM2, Node 20 LTS, GitHub Actions |

---

## Codebase charts

```mermaid
pie showData title Web pages by surface (167)
  "Admin" : 51
  "Platform" : 51
  "Customer" : 47
  "Rider web" : 10
  "Kitchen" : 5
  "Other" : 3
```

```mermaid
pie showData title Vitest test files by area (274)
  "Server core" : 114
  "API routes" : 46
  "Google reviews" : 33
  "tests/unit" : 17
  "Payments" : 15
  "Flavrly PG" : 12
  "Observability" : 9
  "Auth, checkout, dispatch, lib, delivery, geo, push, http" : 28
```

---

## Testing and CI

```bash
cd apps/web
npm run typecheck          # tsc --noEmit
npm run lint               # next lint
npm run check:responsive   # responsive-layout guardrail
npm run test:ci            # Vitest unit + integration
DATABASE_URL="postgresql://ci@localhost:5432/ci_local?schema=public" npm run test:db   # real PostgreSQL
npm run test:e2e           # Playwright end-to-end
```

`test:db` resets the target database and refuses any URL that is not on localhost with a database name starting with `ci`. Money-critical invariants (unique allocation, row locks, concurrent wallet debits) are proven there against real PostgreSQL. The rider app is checked with `cd apps/rider-native && npm run typecheck && npm run lint`.

```mermaid
flowchart LR
  PR["Push or pull request"] --> WEB
  PR --> SEC
  PR --> RN
  PR --> CQ
  subgraph WEB["CI: Web"]
    direction TB
    W1["npm ci, prisma generate"] --> W2["prisma migrate deploy"] --> W3["drift check:<br/>migrations match schema"] --> W4["typecheck"] --> W5["lint"] --> W6["responsive guardrail"] --> W7["unit tests"] --> W8["DB tests"] --> W9["production build"]
  end
  subgraph SEC["CI: Security scans"]
    direction TB
    S1["gitleaks"] --> S2["npm audit"]
  end
  subgraph RN["CI: Rider app"]
    direction TB
    R1["typecheck"] --> R2["lint"]
  end
  CQ["CodeQL<br/>security-extended"]
  WEB --> GATE{"CI green<br/>on main?"}
  SEC --> GATE
  RN --> GATE
  GATE -->|yes| DEP["Deploy to VPS<br/>needs VPS_KNOWN_HOSTS secret"]
```

---

## Repository layout

```
.
├── apps/
│   ├── web/                       Next.js app: every web surface + API
│   │   ├── src/app/
│   │   │   ├── (customer)/        storefront, discovery, cart, checkout, orders, profile
│   │   │   ├── admin/             restaurant admin
│   │   │   ├── kitchen/           kitchen board
│   │   │   ├── platform/          super-admin platform
│   │   │   ├── rider/             rider web portal
│   │   │   ├── login/             role-aware sign-in
│   │   │   └── api/               REST + SSE + webhooks + jobs
│   │   ├── src/server/            domain modules (tenancy, orders, payments, pg, dispatch,
│   │   │                          reviews, training, help, observability, notifications, ...)
│   │   ├── src/components/, src/lib/
│   │   ├── prisma/                schema.prisma, migrations/, seeds
│   │   ├── __tests__/, tests/     Vitest suites (tests/db = real PostgreSQL)
│   │   └── e2e/                   Playwright specs
│   └── rider-native/              Expo / React Native rider app
├── deploy/                        nginx, cron jobs, backups, production env example
├── docs/                          architecture, runbooks, flavrly-pg/, diagrams
├── scripts/                       deploy-remote.sh, go-live.sh, checks, pg-uat/
├── .github/workflows/             ci.yml, codeql.yml, deploy.yml
├── docker-compose.yml, Dockerfile
└── README.md
```

---

## Local development

Requires **Node 20+** and **PostgreSQL 15+** (or Docker).

```bash
# Option A: Docker (Postgres + app)
docker compose up --build

# Option B: local
cd apps/web
cp .env.example .env            # set DATABASE_URL, NEXTAUTH_SECRET, ...
npm install
npx prisma migrate deploy       # apply migrations
npm run db:seed                 # sample restaurants, menu, users
npm run dev                     # http://localhost:3000
```

Integrations fall back to mock adapters when keys are absent, so the app runs locally without third-party accounts. In development, phone OTP codes are printed to the server console. Demo accounts are listed in [`docs/DEMO-ACCOUNTS.md`](docs/DEMO-ACCOUNTS.md) — local seeds only, never for production.

---

## Deployment

Reference target: one VPS with **PostgreSQL, nginx and PM2** (process `rm-web`), repo at `/opt/restaurant-manager`.

- **Releases** follow [`docs/GO_LIVE_RUNBOOK.md`](docs/GO_LIVE_RUNBOOK.md) with `scripts/go-live.sh`: `preflight` (read-only) → `backup` → `migrate` (`prisma migrate deploy`, with a one-time baseline for databases created by `db push`) → `deploy` → `post`. Every changing step asks for confirmation; rollback is `go-live.sh rollback <sha>`.
- **Continuous deploy** (`.github/workflows/deploy.yml`) runs only after CI passes on `main`, over SSH with a pinned host key (`VPS_KNOWN_HOSTS`). Schema changes are applied only on a manual dispatch with `migrate=true`.
- **Rider app** builds with EAS — see [`apps/rider-native/BUILD.md`](apps/rider-native/BUILD.md) — and is published from `/platform/app-releases`.
- **Background jobs** are installed from [`deploy/flavrly-jobs.cron`](deploy/flavrly-jobs.cron).

More: [`docs/PRODUCTION-DEPLOY.md`](docs/PRODUCTION-DEPLOY.md), [`docs/DEPLOY-INDIA.md`](docs/DEPLOY-INDIA.md), [`docs/flavrly-pg/DEPLOYMENT_AND_ROLLBACK.md`](docs/flavrly-pg/DEPLOYMENT_AND_ROLLBACK.md).

---

## Environment variables

Full list: [`apps/web/.env.example`](apps/web/.env.example) and [`deploy/.env.production.example`](deploy/.env.production.example).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | Auth base URL and signing secret |
| `NEXT_PUBLIC_BRAND_NAME` | White-label platform name (default `Flavrly`) |
| `PUBLIC_HOST`, `PORTAL_HOST` | Customer and staff hostnames (default `flavrly.in`, `portal.flavrly.in`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Customer Google sign-in |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | Google Business Profile (reviews) |
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY` | Maps and Places features |
| `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_WEBHOOK_USERNAME`, `PHONEPE_WEBHOOK_PASSWORD` | PhonePe checkout and webhook authentication |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay checkout and webhooks |
| `NOTIFIER_SMS`, `TWOFACTOR_API_KEY` | SMS / OTP delivery |
| `STORAGE_DRIVER` | File storage (local or S3) |
| `INTERNAL_CRON_SECRET` | Authenticates cron job routes |
| `FLAVRLY_PG_NEW_PAYMENTS_ENABLED` | Flavrly PG direct UPI — keep unset/false in production |

---

## Diagram gallery

Generated by [`docs/gen-diagrams.py`](docs/gen-diagrams.py) (`python3 docs/gen-diagrams.py`, needs `cairosvg`).

### System architecture
![System architecture](docs/system-architecture-v2.png)

### Technical architecture
![Technical architecture](docs/technical-architecture-v2.png)

### Data flow: place order
![Data flow](docs/data-flow-v2.png)

### Third-party integrations
![Third-party integrations](docs/integrations-v2.png)

### End-to-end order flow
![End-to-end order flow](docs/end-to-end-flow-v2.png)

---

## Further docs

| Topic | Documents |
|---|---|
| Architecture | [`ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`ARCHITECTURE-V2.md`](docs/ARCHITECTURE-V2.md), [`API.md`](docs/API.md), [`SUBDOMAIN-TENANCY.md`](docs/SUBDOMAIN-TENANCY.md), [`iam.md`](docs/iam.md) |
| Operations | [`GO_LIVE_RUNBOOK.md`](docs/GO_LIVE_RUNBOOK.md), [`PRODUCTION-DEPLOY.md`](docs/PRODUCTION-DEPLOY.md), [`DEPLOY-INDIA.md`](docs/DEPLOY-INDIA.md), [`GIT-BACKUP.md`](docs/GIT-BACKUP.md) |
| Payments | [`PHONEPE-INTEGRATION.md`](docs/PHONEPE-INTEGRATION.md), [`flavrly-pg/`](docs/flavrly-pg/) (go/no-go, invariants, reconciliation, threat model, runbook) |
| Features | [`GOOGLE-REVIEWS-SETUP.md`](docs/GOOGLE-REVIEWS-SETUP.md), [`KYC-VERIFICATION.md`](docs/KYC-VERIFICATION.md), [`ROADMAP.md`](docs/ROADMAP.md) |
| Security and compliance | [`security-audit.md`](docs/security-audit.md), [`rate-limiting.md`](docs/rate-limiting.md), [`legal-privacy-compliance.md`](docs/legal-privacy-compliance.md) |
| Quality | [`QA-TEST-PLAN.md`](docs/QA-TEST-PLAN.md), [`flavrly-pg/TEST_EVIDENCE.md`](docs/flavrly-pg/TEST_EVIDENCE.md) |

---

## License

MIT.
