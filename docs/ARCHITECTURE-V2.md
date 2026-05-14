# Maverick's Food Hub — Architecture Documentation v2

**Version:** 2.0 · **Status:** Phase 1 production, Phase 2 roadmap approved
**Audience:** Engineering, leadership, investor demos, onboarding, operations planning
**Stack:** Next.js 15 modular monolith · React 19 · TypeScript · Prisma · PostgreSQL · SSE · Cloudflare/nginx/PM2 on VPS

> This is the comprehensive enterprise-grade documentation package — ten diagrams, narrative captions, design rationale, and a scaling roadmap. The original Phase-1 overview at `ARCHITECTURE.md` is preserved as a historical reference. Standalone `.mmd` files for every diagram live in `docs/diagrams/` for paste-in to Excalidraw, draw.io, or [mermaid.live](https://mermaid.live).

---

## Quick Context

Maverick's Food Hub is an **India-first, low-cost, multi-tenant food ordering and delivery platform** designed to run profitably on a single VPS in Phase 1 and scale horizontally only when revenue demands it. Customers order through a **QR-driven mobile PWA** (no native customer app). Only **riders ship with an Android app** (Capacitor wrapper around the same PWA codebase). Realtime is built on **Server-Sent Events** plumbed through an in-process EventEmitter — no Redis, no message broker, no Kubernetes.

The deliberate constraint set: ship a complete two-sided marketplace experience supporting umbrella brands with multiple cuisines, deep operational tooling, and rich growth surfaces (offers, happy hours, challenges, cross-channel coupons, signup bonuses, post-delivery feedback) without leaving the modular-monolith comfort zone until traffic justifies the move.

## Reading guide

Each section: **diagram → component table → design rationale**.

1. [Technical Architecture](#1-technical-architecture)
2. [Business Architecture](#2-business-architecture)
3. [Data Flow Diagram](#3-data-flow-diagram)
4. [System Infrastructure & Scaling Roadmap](#4-system-infrastructure--scaling-roadmap)
5. [Realtime Communication](#5-realtime-communication)
6. [Order State Machine](#6-order-state-machine)
7. [Ecosystem Infographic](#7-ecosystem-infographic)
8. [Live Operations Dashboard](#8-live-operations-dashboard)
9. [Multi-tenant Architecture](#9-multi-tenant-architecture)
10. [Mobile + Web Experience Journey Map](#10-mobile--web-experience-journey-map)
11. [Appendix: Scaling Roadmap, Design Principles](#11-appendix)

## Glossary

| Term | Meaning |
|---|---|
| **Umbrella brand** | A `Brand` row that owns multiple `Restaurant` rows ("cuisine concepts") — e.g. Maverick Hospitality houses Italia Pizza, Biryani Zone, Wok and Sizzler, etc. |
| **Cuisine concept** | A `Restaurant` row under a Brand. Has its own menu, branches, offers, KYC riders. |
| **Branch** | A physical kitchen + service area. Multiple Branches per Restaurant. |
| **Pool** | Platform-wide queue of READY orders. Any approved rider can claim. |
| **SSE channel** | A named EventEmitter topic; clients subscribe via `/api/events?channel=…`. |
| **PWA** | Progressive Web App — the customer ordering site, also wrapped as a rider Android shell via Capacitor. |

---

## 1. Technical Architecture

> **The whole platform on one page.** Layered modular-monolith with a thin client tier (PWA + Capacitor rider shell + admin React surfaces), a unified Next.js app server that exposes API routes + server-rendered pages, a Prisma data tier on PostgreSQL, an in-process realtime fan-out, and a small ring of external providers for SMS / email / payments.

```mermaid
flowchart TB
    classDef client fill:#fef3e7,stroke:#d97706,stroke-width:1.5px,color:#7c2d12
    classDef edge fill:#eef2ff,stroke:#4338ca,stroke-width:1.5px,color:#1e1b4b
    classDef app fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef data fill:#f1f5f9,stroke:#475569,stroke-width:1.5px,color:#0f172a
    classDef ext fill:#fdf4ff,stroke:#a21caf,stroke-width:1.5px,color:#581c87
    classDef ops fill:#fefce8,stroke:#a16207,stroke-width:1.5px,color:#713f12

    subgraph CLI[Client tier]
        direction LR
        C1[Customer PWA<br/><i>QR entry, menu, cart,<br/>checkout, OTP, tracker</i>]
        C2[Rider Android App<br/><i>Capacitor wrapper +<br/>foreground GPS service</i>]
        C3[Restaurant Admin<br/><i>Orders, menu, offers,<br/>happy hours, reports</i>]
        C4[Kitchen Panel<br/><i>KOT, prep, ready,<br/>delay alerts</i>]
        C5[Super Admin Portal<br/><i>Restaurants, riders, KYC,<br/>reconciliation, analytics</i>]
    end

    subgraph EDGE[Edge tier]
        CF[Cloudflare<br/><i>DNS · WAF · CDN · SSL</i>]
        NX[nginx reverse proxy<br/><i>TLS termination ·<br/>static caching · gzip</i>]
    end

    subgraph APP[Application tier · Next.js 15 modular monolith]
        direction TB
        WEB[Next.js server<br/><i>App Router · RSC ·<br/>React 19</i>]
        API[API routes<br/><i>REST · /api/*</i>]
        AUTH[NextAuth v5<br/><i>Phone OTP · Email/PW ·<br/>Google OAuth</i>]
        ORD[Order machine<br/><i>State transitions ·<br/>side effects</i>]
        OFF[Offer + Happy Hour<br/>engines<br/><i>Resolvers, redemption</i>]
        SSE[SSE fan-out<br/><i>EventEmitter ·<br/>channel:* subscribers</i>]
        ALR[Alerts + Audit<br/><i>Notification + debounce</i>]
        STO[Storage adapter<br/><i>Local FS / S3 / R2</i>]
        AUD[Audit log writer]
    end

    subgraph DAT[Data tier]
        PRI[Prisma ORM<br/><i>Type-safe queries</i>]
        PG[(PostgreSQL<br/><i>Single primary</i>)]
        BAK[Nightly backups<br/><i>pg_dump → encrypted<br/>off-site</i>]
    end

    subgraph EXT[External providers]
        RZP[Razorpay<br/><i>UPI · cards · COD</i>]
        SMS[SMS provider<br/><i>MSG91 / Fast2SMS</i>]
        EML[Email SMTP<br/><i>Zoho · Brevo</i>]
        MAP[OSM tiles + Nominatim<br/><i>Free maps + geocoding</i>]
    end

    subgraph OPS[Operations]
        PM2[PM2<br/><i>Process supervisor ·<br/>auto-restart · logs</i>]
        MON[Monitoring<br/><i>Pino logs · UptimeRobot</i>]
        UBN[Ubuntu 22.04 VPS<br/><i>4 vCPU · 8 GB RAM</i>]
    end

    C1 -- HTTPS --> CF
    C2 -- HTTPS --> CF
    C3 -- HTTPS --> CF
    C4 -- HTTPS --> CF
    C5 -- HTTPS --> CF
    CF --> NX
    NX --> WEB

    WEB --> API
    WEB --> AUTH
    API --> ORD
    API --> OFF
    API --> ALR
    API --> STO
    API --> AUD
    ORD --> SSE
    ORD --> AUD
    OFF --> AUD
    AUTH --> PRI
    API --> PRI
    ORD --> PRI
    OFF --> PRI
    PRI --> PG
    PG --> BAK

    API -- Razorpay SDK --> RZP
    ALR -- SMTP --> EML
    ALR -- HTTPS --> SMS
    C1 -. tiles .-> MAP
    C2 -. tiles .-> MAP

    SSE -- text/event-stream --> C1
    SSE -- text/event-stream --> C2
    SSE -- text/event-stream --> C3
    SSE -- text/event-stream --> C4
    SSE -- text/event-stream --> C5

    PM2 -. supervises .-> WEB
    MON -. observes .-> PM2
    MON -. observes .-> PG
    UBN -. hosts .-> NX
    UBN -. hosts .-> WEB
    UBN -. hosts .-> PG
    STO -- file:/// --> UBN

    class C1,C2,C3,C4,C5 client
    class CF,NX edge
    class WEB,API,AUTH,ORD,OFF,SSE,ALR,STO,AUD app
    class PRI,PG,BAK data
    class RZP,SMS,EML,MAP ext
    class PM2,MON,UBN ops
```

### Component breakdown

| Layer | Component | Responsibility |
|---|---|---|
| Client | Customer PWA | Mobile-first ordering surface entered via QR. Single Next.js codebase, served as a PWA. |
| Client | Rider Android | Capacitor wrapper around the rider PWA path. Adds foreground GPS service, push permission, install-as-app shell. |
| Client | Admin / Kitchen / Super Admin | Same Next.js app, role-gated routes (`/admin`, `/kitchen`, `/platform`). React Server Components for read-heavy pages. |
| Edge | Cloudflare | Free-tier DNS + WAF + asset cache + universal SSL. |
| Edge | nginx | TLS termination, static asset caching, gzip, upstream to Next.js on `127.0.0.1:3000`. |
| App | Next.js server | Single Node.js process. App Router pages + API routes share one bundle. |
| App | Order machine | `src/server/orders.ts` is the only place that mutates `Order.status`. Validates transitions, fires side effects (loyalty, signup bonus, challenge progress, audit, SSE publish). |
| App | Offer + Happy Hour engines | Pure resolvers (`offers.ts`, `happy-hours.ts`) called from `pricing.ts` and `placeOrder`. Tested without a DB. |
| App | SSE fan-out | `src/server/realtime.ts` — Node `EventEmitter` with named channels. HTTP route streams `text/event-stream`. |
| App | Alerts | `src/server/alerts.ts` — debounce-aware menu/integration alert dispatcher. Writes `NotificationLog` + `AuditLog`. |
| App | Storage adapter | Pluggable interface; Phase 1 writes to local FS, Phase 2 swaps to S3/R2 with zero call-site changes. |
| Data | Prisma | Generates type-safe queries from `prisma/schema.prisma`. |
| Data | PostgreSQL | Single primary on the same VPS. Phase 1: WAL archiving + nightly `pg_dump` to encrypted off-site bucket. |
| External | Razorpay | UPI / card / netbanking. COD handled internally. |
| External | SMS + Email | Pluggable through `IntegrationCredential` rows (encrypted at rest via AES-256-GCM). |
| External | OSM | Free tile server + Nominatim geocoding for address autocomplete. |
| Ops | PM2 | Single-instance process supervisor with log rotation and crash restart. |
| Ops | Monitoring | Pino structured logs + UptimeRobot external health checks. |

### Design rationale

- **Modular monolith over microservices.** The whole product fits in one Node.js process. Each domain (orders, offers, happy hours, challenges, feedback, alerts) is a separate `src/server/*.ts` module with its own pure resolver + DB-aware boundary. Modules talk through function calls and the in-process `EventEmitter` — no network hops, no service mesh, no service discovery. When a module's load justifies extraction (Phase 4), the resolver lifts out cleanly.
- **SSE over WebSockets.** SSE rides on plain HTTP/2, traverses nginx + Cloudflare without sticky-session tricks, auto-reconnects in every modern browser, and survives the long mobile-network coffee breaks our riders take. WebSocket benefits (bidirectional, binary frames) aren't worth the operational overhead at this stage.
- **VPS over Kubernetes.** A single 8 GB VPS comfortably runs the app server, Postgres, nginx, PM2, and backup cron jobs for the first ~20 restaurants × 500 daily orders each. Phase 3 splits the DB onto its own box; Phase 4 fronts multiple app servers with a load balancer.
- **Pluggable externals.** Payments, SMS, email, storage, maps each go through an `IntegrationCredential`-driven adapter. Provider swaps are a config change, not a code change. AES-256-GCM keeps credentials encrypted at rest.

---

## 2. Business Architecture

> **Who does what.** Six business actors, ten business capabilities, and the relationships that turn a single delivered order into revenue, loyalty, and operational data.

```mermaid
flowchart LR
    classDef actor fill:#fff7ed,stroke:#ea580c,stroke-width:2px,color:#7c2d12
    classDef cap fill:#eef2ff,stroke:#4338ca,stroke-width:1.5px,color:#1e1b4b
    classDef growth fill:#ecfdf5,stroke:#059669,stroke-width:1.5px,color:#064e3b
    classDef ops fill:#fdf4ff,stroke:#a21caf,stroke-width:1.5px,color:#581c87

    subgraph ACTORS[Business actors]
        direction TB
        A1((Customer))
        A2((Restaurant<br/>Owner))
        A3((Kitchen<br/>Staff))
        A4((Rider))
        A5((Super<br/>Admin))
        A6((Platform<br/>Operator))
    end

    subgraph CORE[Core capabilities]
        CORE1[Ordering &<br/>Checkout]
        CORE2[Kitchen<br/>Operations]
        CORE3[Delivery<br/>Operations]
        CORE4[Payments &<br/>COD]
    end

    subgraph GROW[Growth capabilities]
        G1[Offers &<br/>Coupons]
        G2[Happy Hour<br/>Pricing]
        G3[Cross-channel<br/>Campaigns]
        G4[Challenges &<br/>Gamification]
        G5[Signup Bonus &<br/>Loyalty]
        G6[Cross-sell &<br/>Combos]
    end

    subgraph OPSCAP[Operational capabilities]
        O1[Rider Management<br/>+ KYC]
        O2[Multi-cuisine<br/>Umbrella]
        O3[Feedback &<br/>Quality]
        O4[Analytics &<br/>Reporting]
        O5[Support &<br/>Reconciliation]
    end

    A1 -- places orders --> CORE1
    A1 -- pays via --> CORE4
    A1 -- redeems --> G1
    A1 -- redeems --> G2
    A1 -- earns --> G4
    A1 -- earns --> G5
    A1 -- rates --> O3

    A2 -- configures --> CORE1
    A2 -- configures --> G1
    A2 -- configures --> G2
    A2 -- configures --> G3
    A2 -- configures --> G6
    A2 -- monitors --> CORE2
    A2 -- views --> O4

    A3 -- prepares --> CORE2
    A3 -- toggles availability --> CORE1
    A3 -- alerts on delays --> CORE2

    A4 -- onboards via --> O1
    A4 -- claims orders --> CORE3
    A4 -- collects --> CORE4
    A4 -- receives rating --> O3

    A5 -- approves --> O1
    A5 -- governs --> O2
    A5 -- configures --> G3
    A5 -- configures --> G5
    A5 -- reconciles --> O5
    A5 -- monitors --> O4

    A6 -- supports --> O5
    A6 -- audits --> O5

    CORE1 -. consumed by .-> CORE2
    CORE2 -. handoff to .-> CORE3
    CORE3 -. closes .-> CORE4
    CORE4 -. funds .-> O5
    O3 -. feeds .-> O4
    G1 -. discount applied at .-> CORE1
    G2 -. price-locks at .-> CORE1
    G3 -. issues codes for .-> G1
    G4 -. emits coupons for .-> G1
    G5 -. auto-applies to .-> CORE1
    G6 -. boosts AOV in .-> CORE1
    O2 -. groups .-> CORE1

    class A1,A2,A3,A4,A5,A6 actor
    class CORE1,CORE2,CORE3,CORE4 cap
    class G1,G2,G3,G4,G5,G6 growth
    class O1,O2,O3,O4,O5 ops
```

### Capability responsibilities

| Capability | Owner | Surface | Inputs | Outputs |
|---|---|---|---|---|
| Ordering & Checkout | Customer + Restaurant Owner | Customer PWA, Admin orders board | Cart, address, payment method | `Order` row, `OrderItem` rows, SSE event |
| Kitchen Operations | Kitchen Staff | Kitchen Panel | Order state, item availability | KOT, status transitions |
| Delivery Operations | Rider + Restaurant | Rider Android app, Admin live tracking | READY orders, rider GPS | `RiderAssignment`, `DeliveryLocationPing` |
| Payments & COD | Customer + Razorpay | Checkout, COD reconciliation | Order total, payment method | `Payment`, `CodCollection` |
| Offers & Coupons | Restaurant Owner | Admin → Offers | Discount config | `Offer`, `OfferRedemption` |
| Happy Hour | Restaurant Owner | Admin → Happy Hours | Time-of-day rules | Item price overrides at checkout |
| Cross-channel Campaigns | Restaurant Owner | Admin → Coupon Campaigns | Code prefix, channel direction | `CouponCampaign` → `Offer` |
| Challenges | Super Admin | `/admin/challenges` | Target, window, reward config | `Challenge`, `ChallengeProgress`, `ChallengeReward` |
| Signup Bonus & Loyalty | Super Admin | `/platform/signup-bonus` | Bonus amount, split count | `SignupBonusGrant`, ledger entries |
| Cross-sell & Combos | Restaurant Owner | Admin → Cross-sell + Combos | Parent item, suggested items | `CrossSell`, `Combo` rows |
| Rider Management + KYC | Super Admin | `/platform/kyc` | Aadhaar, license, insurance docs | `RiderKycDocument` (APPROVED) |
| Multi-cuisine Umbrella | Super Admin | `/platform/brands` | Cuisine assignments | `Brand` rollups |
| Feedback & Quality | Customer + all roles | `/profile/orders`, `/admin/feedback` | Ratings + tags + image | `OrderFeedback`, role-redacted views |
| Analytics & Reporting | Restaurant Owner + Super Admin | `/admin/reports`, `/platform/analytics` | All order + offer + feedback data | Trend lines, leaderboards |
| Support & Reconciliation | Platform Operator | `/platform/support`, COD screen | Tickets, COD bags | Resolved tickets, settled COD |

### Design rationale

The core flow (order → kitchen → delivery → payment) stays untouched by the growth layer — every promotional capability is a **modifier** that decorates the price or unlocks an entitlement, never a special-case branch in the order machine. That isolation is what lets us add nine offer types, happy-hour pricing, signup bonuses, and gamification without making `placeOrder` a 2000-line mess.

---

## 3. Data Flow Diagram

> **What happens between QR scan and a positive feedback row.** Every API call, every DB read/write, every realtime push.

```mermaid
sequenceDiagram
    autonumber
    participant C as Customer (PWA)
    participant CF as Cloudflare + nginx
    participant N as Next.js server
    participant DB as PostgreSQL
    participant SSE as SSE fan-out
    participant RZ as Razorpay
    participant SMS as SMS provider
    participant K as Kitchen Panel
    participant R as Rider Android

    Note over C: 1. QR scan → /r/[slug]
    C->>CF: HTTPS GET /r/italia-pizza
    CF->>N: Forward
    N->>DB: SELECT restaurant + branch + menu (RSC)
    DB-->>N: rows
    N-->>C: SSR HTML + offers + happy-hour prices

    Note over C: 2. Login (OTP)
    C->>N: POST /api/auth/otp { phone }
    N->>SMS: Send 6-digit code
    SMS-->>C: SMS
    C->>N: signIn('credentials', { phone, code })
    N->>DB: upsert User, grant signup bonus
    DB-->>N: session

    Note over C: 3. Cart preview
    C->>N: POST /api/customer/offers/eligible
    N->>DB: load offers + happy hours
    N-->>C: { autoApply, suggestions, bonus preview }

    Note over C: 4. Checkout
    C->>N: POST /api/orders { items, address, paymentMethod }
    N->>DB: BEGIN TX
    N->>DB: apply happy-hour pricing per line
    N->>DB: resolve offers + signup-bonus hold
    N->>DB: INSERT Order + OrderItems + OfferRedemption
    N->>DB: COMMIT
    alt UPI / Card
        N->>RZ: Create order intent
        RZ-->>N: razorpayOrderId
        N-->>C: { orderId, razorpayOrderId }
        C->>RZ: Pay
        RZ->>N: POST /api/webhooks/razorpay (signed)
        N->>DB: UPDATE Payment status=SUCCEEDED
    else COD
        N-->>C: { orderId, status: RECEIVED }
    end

    N->>SSE: publish branch:X:orders { kind: 'new' }
    SSE-->>K: order:new event

    Note over K: 5. Kitchen prep
    K->>N: POST /api/admin/orders/:id/transition { ACCEPTED }
    N->>DB: state machine ACCEPTED
    N->>SSE: publish order:Y { ACCEPTED }
    SSE-->>C: ACCEPTED event
    K->>N: ... PREPARING ... READY

    Note over R: 6. Rider claim
    R->>N: GET /api/rider/pool (SSE subscribed)
    SSE-->>R: order:ready
    R->>N: POST /api/rider/pool/:id/claim
    N->>DB: TX: RiderAssignment, compute payout (override-aware)
    SSE-->>C: rider:assigned

    Note over R: 7. Live GPS
    loop every 5s while OUT_FOR_DELIVERY
        R->>N: POST /api/rider/ping { lat, lng }
        N->>DB: insert DeliveryLocationPing
        N->>SSE: publish order:Y { gps }
        SSE-->>C: marker update
    end

    Note over R: 8. Delivery OTP
    R->>N: POST /api/rider/assignments/:id/verify-otp
    N->>DB: state DELIVERED
    N->>DB: commit signup-bonus, refresh challenge progress
    N->>SMS: receipt SMS
    SSE-->>C: DELIVERED event + feedback CTA

    Note over C: 9. Feedback (within 48h)
    C->>N: POST /api/customer/orders/:id/feedback
    N->>DB: INSERT OrderFeedback (windowEndsAt = +48h)
    N->>DB: audit('order.feedback.submitted')
```

### Design rationale

- **Idempotency is non-negotiable.** Payment webhooks, rider OTP verification, and bonus commits all check for prior side effects before re-applying. Razorpay's webhook is HMAC-verified and idempotency-keyed by `razorpayPaymentId`.
- **Transactions wrap the critical writes.** Order creation includes offer redemptions, signup-bonus pending hold, and `OrderItem` snapshots in a single `prisma.$transaction` — partial failure rolls everything back.
- **SSE is fire-and-forget downstream of DB writes.** A failed publish never rolls back a committed order. The customer reconnect logic re-syncs on the next render.

---

## 4. System Infrastructure & Scaling Roadmap

> **Where bits live today and how we scale when we need to.** Single-VPS Phase 1 with a clear, cost-justified path through three growth phases.

```mermaid
flowchart TB
    classDef p1 fill:#ecfdf5,stroke:#059669,stroke-width:2px,color:#064e3b
    classDef p2 fill:#eff6ff,stroke:#2563eb,stroke-width:2px,color:#1e3a8a
    classDef p3 fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
    classDef p4 fill:#fce7f3,stroke:#be185d,stroke-width:2px,color:#831843

    subgraph PHASE1[Phase 1 — Current · single VPS]
        P1_CF[Cloudflare Free<br/><i>DNS · TLS · WAF · cache</i>]
        P1_NX[nginx<br/><i>TLS · static cache · gzip</i>]
        P1_APP[Next.js standalone<br/><i>PM2 supervisor ·<br/>4 vCPU / 8 GB RAM</i>]
        P1_PG[(PostgreSQL 16<br/><i>Same box · WAL archive</i>)]
        P1_FS[Local FS uploads<br/><i>/var/uploads</i>]
        P1_BAK[Cron pg_dump<br/><i>Nightly · encrypted<br/>off-site bucket</i>]
        P1_MON[Pino + UptimeRobot]

        P1_CF --> P1_NX --> P1_APP --> P1_PG
        P1_APP --> P1_FS
        P1_PG --> P1_BAK
        P1_APP -.-> P1_MON
    end

    subgraph PHASE2[Phase 2 — Growth · +Redis, object storage, CDN]
        P2_R2[Cloudflare R2<br/><i>S3-compat · zero egress</i>]
        P2_RD[Redis<br/><i>Session · rate-limit ·<br/>SSE backplane</i>]
        P2_APP[Next.js + R2 adapter<br/><i>Storage swap zero-touch</i>]
        P2_CDN[Cloudflare CDN<br/><i>Image transforms ·<br/>asset cache</i>]

        P2_APP --> P2_R2
        P2_APP --> P2_RD
        P2_R2 --> P2_CDN
    end

    subgraph PHASE3[Phase 3 — Scale · DB split, multi-app]
        P3_LB[nginx / Cloudflare<br/>load balancer]
        P3_APP[2-3× Next.js boxes<br/><i>Stateless · session in Redis</i>]
        P3_POOL[PgBouncer<br/><i>Pool connections</i>]
        P3_PG[(Dedicated PG box<br/><i>Primary + read replica</i>)]

        P3_LB --> P3_APP --> P3_POOL --> P3_PG
    end

    subgraph PHASE4[Phase 4 — Intelligence · ML dispatch, warehouse]
        P4_AI[AI dispatch service<br/><i>Lifted from server/dispatch</i>]
        P4_DW[(Analytics warehouse<br/><i>ClickHouse / BigQuery</i>)]
        P4_FX[Feature extraction<br/><i>Cron → warehouse</i>]
        P4_RT[Smart multi-stop<br/>routing optimizer]

        P4_FX --> P4_DW --> P4_AI --> P4_RT
    end

    PHASE1 -. "20 restaurants ·<br/>5k DAU" .-> PHASE2
    PHASE2 -. "100 restaurants ·<br/>50k DAU" .-> PHASE3
    PHASE3 -. "1000 restaurants ·<br/>500k DAU" .-> PHASE4

    class P1_CF,P1_NX,P1_APP,P1_PG,P1_FS,P1_BAK,P1_MON p1
    class P2_R2,P2_RD,P2_APP,P2_CDN p2
    class P3_LB,P3_APP,P3_POOL,P3_PG p3
    class P4_AI,P4_DW,P4_FX,P4_RT p4
```

### Cost snapshot per phase

| Phase | Monthly target cost | Triggers entry |
|---|---|---|
| Phase 1 | ~₹4 000 (₹3 500 VPS + ₹500 Cloudflare-ish) | Day 1 |
| Phase 2 | ~₹12 000 | App memory > 70% sustained, image bandwidth > 50 GB/mo |
| Phase 3 | ~₹35 000 | DB CPU > 60% sustained, concurrent SSE > 5 000 |
| Phase 4 | ~₹85 000 | Dispatch SLA misses, > 50k orders/day |

### Design rationale

We refuse to pay for what we don't yet need. A 4 vCPU / 8 GB VPS handles the first 20 restaurants comfortably. Redis enters only when we need a multi-process SSE backplane (after we split app servers). The warehouse comes online only when feature extraction outgrows ad-hoc Postgres aggregations. Every transition is reversible: nothing in Phase 1 architecturally precludes any of the later phases.

---

## 5. Realtime Communication

> **How a kitchen panel knows a new order arrived 250 ms after the customer tapped Pay.** SSE channels, the EventEmitter backbone, and the polling fallback for clients in tunnel-mode networks.

```mermaid
flowchart LR
    classDef pub fill:#fef3c7,stroke:#b45309,stroke-width:1.5px,color:#78350f
    classDef bus fill:#ede9fe,stroke:#5b21b6,stroke-width:2px,color:#3c1361
    classDef sub fill:#ecfeff,stroke:#0e7490,stroke-width:1.5px,color:#164e63
    classDef fb fill:#fee2e2,stroke:#b91c1c,stroke-width:1.5px,color:#7f1d1d

    subgraph PUB[Publishers]
        PUB1[placeOrder]
        PUB2[transitionOrder]
        PUB3[rider/ping]
        PUB4[rider/pool/claim]
        PUB5[admin/orders/cancel]
    end

    subgraph BUS[Bus]
        EM{{EventEmitter<br/><i>src/server/realtime.ts</i>}}
        CH1[branch:X:orders]
        CH2[order:Y]
        CH3[rider:pool]
        CH4[platform:riders]
        CH5[admin:live]
    end

    subgraph SUB[Subscribers via SSE]
        S1[Kitchen Panel]
        S2[Customer tracker]
        S3[Rider order list]
        S4[Super-admin live map]
        S5[Admin live orders]
    end

    subgraph FB[Fallback]
        POLL[Polling client<br/><i>setInterval 5 s ·<br/>If-Modified-Since</i>]
    end

    PUB1 --> EM
    PUB2 --> EM
    PUB3 --> EM
    PUB4 --> EM
    PUB5 --> EM

    EM --> CH1 --> S1
    EM --> CH2 --> S2
    EM --> CH3 --> S3
    EM --> CH4 --> S4
    EM --> CH5 --> S5

    S2 -. on disconnect .-> POLL
    S3 -. on disconnect .-> POLL
    POLL -. GET /api/orders/:id/poll .-> EM

    class PUB1,PUB2,PUB3,PUB4,PUB5 pub
    class EM,CH1,CH2,CH3,CH4,CH5 bus
    class S1,S2,S3,S4,S5 sub
    class POLL fb
```

### Channel catalogue

| Channel | Publisher | Subscribers | Payloads |
|---|---|---|---|
| `branch:<branchId>:orders` | placeOrder, transitionOrder | Kitchen Panel, Admin orders | `order:new`, `order:status` |
| `order:<orderId>` | transitionOrder, rider/ping | Customer tracker, Admin drawer | status, ETA, GPS |
| `rider:pool` | transitionOrder (READY), claim | Rider order list | `order:new`, `order:claimed` |
| `platform:riders` | rider/ping | Super-admin live map | All rider GPS pings |
| `admin:live` | transitionOrder, escalation engine | Super-admin live ops | Alerts, delays |

### Why SSE not WebSockets?

| Concern | SSE | WebSockets |
|---|---|---|
| Direction | Server → Client | Bidirectional |
| Transport | HTTP/1.1 + HTTP/2 | Custom over TCP after upgrade |
| Reconnect | Automatic in every browser | Manual library logic |
| Proxy / CDN compatibility | Trivial — it's just HTTP | Sticky sessions, header forwarding |
| Cloudflare free tier | Works out of the box | Needs paid plans for sticky |
| Mobile network friendliness | Resilient to network hops | Sensitive |
| Authentication | Cookie / Authorization header | Per-message JWT or upgrade-time |

Customer-side traffic is **overwhelmingly server-to-client** — order status updates, GPS pings, kitchen alerts, feedback prompts. The few client-to-server cases (place order, claim, transition) are perfectly modelled as plain HTTP POSTs. We get every benefit we'd hope for from WebSockets with none of the operational tax.

### Fallback polling

Some hotel Wi-Fi and corporate networks strip `Content-Type: text/event-stream`. When the EventSource fails to connect within 10 s, the client falls back to a 5-second `If-Modified-Since`-aware `GET /api/orders/:id/poll`. The polling endpoint returns the same shape as an SSE message so call sites need no special-casing.

---

## 6. Order State Machine

> **The single source of truth for status transitions.** Every transition is validated against this graph in `src/server/orders.ts`. Illegal transitions throw `OrderTransitionError`.

```mermaid
stateDiagram-v2
    [*] --> PAYMENT_PENDING: Customer clicks Pay

    PAYMENT_PENDING --> RECEIVED: Razorpay webhook /<br/>COD chosen
    PAYMENT_PENDING --> PAYMENT_FAILED: Webhook failure /<br/>timeout
    PAYMENT_PENDING --> CANCELLED_BY_CUSTOMER: Customer cancels
    PAYMENT_PENDING --> CANCELLED_BY_ADMIN: Admin force-cancel

    PAYMENT_FAILED --> RECEIVED: Retry success
    PAYMENT_FAILED --> CANCELLED: Auto-cancel after 30m

    RECEIVED --> ACCEPTED: Restaurant accepts
    RECEIVED --> CANCELLED_BY_CUSTOMER: < 2m window
    RECEIVED --> CANCELLED_BY_RESTAURANT: Reject

    ACCEPTED --> PREPARING: Kitchen starts
    ACCEPTED --> CANCELLED_BY_RESTAURANT: Out of stock

    PREPARING --> READY: KOT marked ready
    PREPARING --> CANCELLED_BY_RESTAURANT: Equipment failure

    READY --> RIDER_ASSIGNED: Rider claims
    READY --> OUT_FOR_DELIVERY: Direct claim
    READY --> CANCELLED_BY_ADMIN: No rider 20m

    RIDER_ASSIGNED --> RIDER_REACHED_RESTAURANT: Rider arrives
    RIDER_ASSIGNED --> PICKED_UP: Rider picks up
    RIDER_ASSIGNED --> OUT_FOR_DELIVERY: Rider leaves

    RIDER_REACHED_RESTAURANT --> PICKED_UP: Kitchen handoff
    PICKED_UP --> OUT_FOR_DELIVERY: Rider en route
    PICKED_UP --> RIDER_REACHED_CUSTOMER: Direct arrival
    PICKED_UP --> DELIVERY_FAILED: Address invalid

    OUT_FOR_DELIVERY --> RIDER_REACHED_CUSTOMER: Within 100 m geofence
    OUT_FOR_DELIVERY --> DELIVERED: Direct (rare)
    OUT_FOR_DELIVERY --> DELIVERY_FAILED: Customer not home
    OUT_FOR_DELIVERY --> CANCELLED_BY_ADMIN: Manual

    RIDER_REACHED_CUSTOMER --> DELIVERED: OTP verified
    RIDER_REACHED_CUSTOMER --> DELIVERY_OTP_FAILED: Wrong OTP × 3
    RIDER_REACHED_CUSTOMER --> CUSTOMER_UNREACHABLE: Phone unreachable
    RIDER_REACHED_CUSTOMER --> DELIVERY_FAILED: Customer refused

    DELIVERY_OTP_FAILED --> DELIVERED: Admin override
    DELIVERY_OTP_FAILED --> DELIVERY_FAILED: Escalation

    CUSTOMER_UNREACHABLE --> DELIVERED: Customer answers
    CUSTOMER_UNREACHABLE --> DELIVERY_FAILED: 15-min timeout

    DELIVERY_FAILED --> REFUND_PENDING: Auto-refund

    DELIVERED --> REFUND_PENDING: Customer dispute
    DELIVERED --> REFUND_INITIATED: Admin issues refund

    CANCELLED_BY_CUSTOMER --> REFUND_PENDING
    CANCELLED_BY_RESTAURANT --> REFUND_PENDING
    CANCELLED_BY_ADMIN --> REFUND_PENDING

    REFUND_PENDING --> REFUND_INITIATED: Razorpay refund call
    REFUND_PENDING --> REFUNDED: Auto-refunded
    REFUND_INITIATED --> REFUNDED: Webhook success

    DELIVERED --> [*]
    REFUNDED --> [*]
    CANCELLED --> [*]
```

### Side effects per transition

| Transition | Side effects |
|---|---|
| → RECEIVED | Loyalty earn preview, SSE `branch:X:orders`, customer SMS |
| → ACCEPTED | KOT visible, ETA computed |
| → READY | Pool publish `rider:pool`, kitchen-ready SMS |
| → RIDER_ASSIGNED | Rider's payout snapshot, SSE `order:Y:assigned` |
| → DELIVERED | Loyalty credit, signup-bonus commit, challenge progress refresh, feedback CTA, customer SMS |
| → CANCELLED_* | Signup-bonus restore, offer redemption rollback, refund kick-off |
| → REFUNDED | Razorpay refund call, COD waiver if applicable, audit log |

### Design rationale

A single declarative `ALLOWED_NEXT: Record<OrderStatus, OrderStatus[]>` table at the top of `orders.ts` means every illegal transition fails at compile + runtime. Side effects are colocated with the transition (not scattered across callers) so adding a new effect — like the recent `commitSignupBonusForOrder` and `refreshChallengeProgressForOrder` on DELIVERED — is a one-line change.

---

## 7. Ecosystem Infographic

> **The whole platform as a hub-and-spoke ecosystem.** Each spoke is a self-contained capability that plugs into the central order engine.

```mermaid
flowchart LR
    classDef center fill:#fbbf24,stroke:#92400e,stroke-width:3px,color:#451a03,font-weight:bold
    classDef spoke fill:#ffffff,stroke:#374151,stroke-width:1.5px,color:#111827

    HUB[("ORDER<br/>ENGINE<br/><br/>Maverick's<br/>Food Hub")]

    subgraph CUSTOMER[Customer Ecosystem]
        E1[QR scan entry]
        E2[Mobile PWA<br/>browsing]
        E3[Cart + offers<br/>auto-apply]
        E4[OTP login]
        E5[Live tracking +<br/>delivery OTP]
        E6[48h feedback]
    end

    subgraph RESTAURANT[Restaurant Ecosystem]
        R1[Menu + categories +<br/>combos]
        R2[Offers · happy hours ·<br/>cross-sell]
        R3[Kitchen KOT panel]
        R4[Reports + ratings]
        R5[Cross-channel<br/>coupon campaigns]
    end

    subgraph RIDERECO[Rider Ecosystem]
        D1[Capacitor<br/>Android app]
        D2[KYC + onboarding]
        D3[Order pool + claim]
        D4[Foreground GPS]
        D5[Earnings +<br/>override rules]
        D6[COD collection]
    end

    subgraph ADMINECO[Admin Ecosystem]
        A1[Super-admin portal]
        A2[KYC approvals]
        A3[Brand umbrellas]
        A4[Challenges + rewards]
        A5[Signup bonus config]
        A6[Live ops dashboard]
    end

    subgraph PAY[Payment Ecosystem]
        P1[Razorpay UPI / Card]
        P2[COD collection]
        P3[Wallet + loyalty]
        P4[Refunds + reconciliation]
    end

    subgraph NOTIF[Notification Ecosystem]
        N1[SMS · MSG91 / Fast2SMS]
        N2[Email · Zoho / Brevo]
        N3[Menu toggle alerts]
        N4[Integration alerts<br/>+ debounce]
    end

    HUB --- CUSTOMER
    HUB --- RESTAURANT
    HUB --- RIDERECO
    HUB --- ADMINECO
    HUB --- PAY
    HUB --- NOTIF

    class HUB center
    class E1,E2,E3,E4,E5,E6,R1,R2,R3,R4,R5,D1,D2,D3,D4,D5,D6,A1,A2,A3,A4,A5,A6,P1,P2,P3,P4,N1,N2,N3,N4 spoke
```

### Pitch deck soundbites

- **QR ordering.** No app install for customers. A QR sticker at the table or door is the entry surface.
- **Realtime everywhere.** SSE delivers status updates, GPS pings, and kitchen alerts in < 250 ms — without WebSocket complexity.
- **Multi-cuisine umbrellas.** One operator runs Italia Pizza, Biryani Zone, Wok and Sizzler under one brand with shared kitchens.
- **Low-cost architecture.** Phase 1 fits on a single ₹3 500/mo VPS with off-site backups and a Cloudflare CDN.
- **India-first.** UPI-native, COD-native, OSM tiles to avoid Google Maps spend, OTP-first login.
- **Mobile-first ordering.** Tailwind + the customer page hierarchy designed for 360–390 px viewports.
- **Rider Android app.** Capacitor wrapper around the rider PWA — one codebase, native shell where it matters (background GPS).

---

## 8. Live Operations Dashboard

> **The operational control center.** What super-admins see when they sign in to run a dinner rush.

```mermaid
flowchart TB
    classDef alert fill:#fee2e2,stroke:#b91c1c,stroke-width:2px,color:#7f1d1d
    classDef warn fill:#fef3c7,stroke:#b45309,stroke-width:2px,color:#78350f
    classDef ok fill:#dcfce7,stroke:#15803d,stroke-width:2px,color:#14532d
    classDef src fill:#e0e7ff,stroke:#4338ca,stroke-width:1.5px,color:#1e1b4b
    classDef esc fill:#f3e8ff,stroke:#7c3aed,stroke-width:1.5px,color:#581c87

    subgraph SOURCES[Signal sources]
        S1[Order state machine]
        S2[Rider heartbeat]
        S3[Payment webhook]
        S4[KYC pipeline]
        S5[COD ledger]
        S6[Support tickets]
        S7[Kitchen panel]
    end

    subgraph DETECT[Detection engine]
        D1{Stuck-order<br/>escalation<br/><i>>20m in same state</i>}
        D2{Rider inactivity<br/><i>no ping > 60s</i>}
        D3{Payment failure<br/>spike<br/><i>>5/min</i>}
        D4{Restaurant pause<br/><i>auto-detect</i>}
    end

    subgraph DASH[Live Ops dashboard tiles]
        T1[Delayed orders<br/>13]
        T2[Riders online<br/>87 / 120]
        T3[No rider assigned<br/>4]
        T4[COD pending<br/>₹12 400]
        T5[Payment failures<br/>2 last hour]
        T6[Restaurants paused<br/>1]
        T7[Support tickets<br/>open · 6]
        T8[Kitchen delays<br/>3]
    end

    subgraph ESCALATE[Escalation engine]
        E1[Auto-reassign rider]
        E2[Page on-call admin]
        E3[Email super admin]
        E4[Slack webhook]
    end

    S1 --> D1
    S2 --> D2
    S3 --> D3
    S7 --> D1
    S4 -. KYC review pending .-> T7
    S5 -. unsettled bags .-> T4
    S6 -. open count .-> T7

    D1 --> T1
    D1 --> T3
    D1 --> T8
    D2 --> T2
    D3 --> T5
    D4 --> T6

    D1 --> E1
    D1 --> E2
    D2 --> E1
    D3 --> E2
    D3 --> E3
    D4 --> E3
    E2 --> E4
    E3 --> E4

    class T1,T3,T5,T6 alert
    class T2,T4,T7,T8 warn
    class S1,S2,S3,S4,S5,S6,S7 src
    class D1,D2,D3,D4 esc
    class E1,E2,E3,E4 esc
```

### Alert thresholds

| Signal | Yellow | Red | Action |
|---|---|---|---|
| Order stuck in PREPARING | > 15 m | > 25 m | Page kitchen lead; auto-suggest re-prep |
| Order in READY with no rider | > 5 m | > 12 m | Boost payout by ₹20; broadcast to all branches |
| Rider GPS silent | > 60 s | > 5 m | Mark "stale"; reassign if order in progress |
| Payment failure rate | > 2% | > 8% | Page on-call; switch Razorpay → fallback gateway |
| COD bag unsettled | > 24 h | > 48 h | Auto-deduct from rider next payout |

### Design rationale

The escalation engine is a single in-process scheduler with no external dependencies. Every signal source writes to the same `OrderEscalation` table, and a cron-style worker scans for breaches every 30 seconds. When an alert fires, it lands on the live ops dashboard via SSE before any external page goes out — operators see issues before their phones buzz.

---

## 9. Multi-tenant Architecture

> **One platform, many brands, many cuisines, many branches — with clean tenant boundaries everywhere it matters.**

```mermaid
flowchart TB
    classDef shared fill:#f1f5f9,stroke:#475569,stroke-width:2px,color:#0f172a
    classDef brand fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
    classDef cuisine fill:#dcfce7,stroke:#15803d,stroke-width:1.5px,color:#14532d
    classDef branch fill:#e0e7ff,stroke:#4338ca,stroke-width:1.5px,color:#1e1b4b
    classDef leaf fill:#fff,stroke:#94a3b8,stroke-width:1px,color:#334155

    subgraph SHARED[Shared platform · single instance]
        SP1[Next.js app · Postgres ·<br/>SSE · payments · SMS · auth]
        SP2[Super admin portal]
        SP3[Audit log · notification log ·<br/>error log]
    end

    subgraph TENANTS[Tenant boundary — Brand: Maverick Hospitality]
        B[Brand: Maverick Hospitality<br/><i>logo · contact · status</i>]

        subgraph CUISINES[Cuisine concepts · Restaurant rows]
            R1[Italia Pizza]
            R2[Biryani Zone]
            R3[Bowl and Barbeque]
            R4[Hotel Siddhartha]
            R5[Wok and Sizzler]
            R6[Party Place]
            R7[Cuisine of Andhra]
        end

        subgraph BRANCHES[Branches · physical kitchens]
            BR1[Koramangala]
            BR2[Indiranagar]
            BR3[HSR Layout]
        end

        subgraph DATA[Tenant-scoped data]
            M1[Menus + categories +<br/>combos]
            M2[Offers + happy hours +<br/>challenges]
            M3[KYC riders]
            M4[Orders + COD ledger]
            M5[Feedback]
        end
    end

    subgraph SOLO[Solo restaurants · brandId = NULL]
        S1[Solo restaurant A]
        S2[Solo restaurant B]
    end

    B --> R1 & R2 & R3 & R4 & R5 & R6 & R7
    R1 & R2 & R3 & R4 & R5 & R6 & R7 --> BR1
    R1 & R2 & R3 & R4 & R5 & R6 & R7 --> BR2
    R1 & R2 & R3 & R4 & R5 & R6 & R7 --> BR3
    BR1 & BR2 & BR3 --> M1
    BR1 & BR2 & BR3 --> M2
    BR1 & BR2 & BR3 --> M3
    BR1 & BR2 & BR3 --> M4
    BR1 & BR2 & BR3 --> M5

    SHARED --- B
    SHARED --- S1
    SHARED --- S2

    class SP1,SP2,SP3 shared
    class B brand
    class R1,R2,R3,R4,R5,R6,R7 cuisine
    class BR1,BR2,BR3 branch
    class M1,M2,M3,M4,M5 leaf
    class S1,S2 cuisine
```

### Isolation by row, not by schema

Every domain table carries a tenant-discriminating FK chain — `OrderItem` → `Order` → `Branch` → `Restaurant` → `Brand` — and every server-side helper (`requireRestaurant`, `currentBrand`) seeds the query's `WHERE` clause from the session. Tenants share infrastructure but never see each other's rows. This row-level model is operationally cheap (no per-tenant migrations, no per-tenant deploys) and trivially supports the "umbrella brand owns N cuisines" case that schema-per-tenant designs make painful.

### Reports compose at any tier

The brand layer exposes four rollup levels through one DB-aware resolver (`getBrandSalesRollup`):

```
brand-wide → cuisine-level (per Restaurant)
            → branch-level (per Branch)
            → item-level (per OrderItem)
```

A single super-admin can drill from "Maverick Hospitality earned ₹4.2L this month" to "Italia Pizza · Koramangala branch · Margherita Pizza · 240 orders · ₹72k" in three clicks.

---

## 10. Mobile + Web Experience Journey Map

> **Four actors, four journeys, one shared platform. The UX rhythm each role lives in.**

```mermaid
journey
    title Customer journey — QR scan to feedback
    section Discovery
      Scan QR at table or doorstep: 5: Customer
      Land on /r/italia-pizza: 5: Customer
      Browse menu with happy-hour prices: 5: Customer
    section Decision
      Add to cart with cross-sell suggestions: 4: Customer
      Auto-applied offer + signup bonus appears: 5: Customer
      Confirm address: 4: Customer
    section Pay
      Enter phone OTP login: 3: Customer
      Razorpay UPI / COD: 4: Customer
      Order confirmation: 5: Customer
    section Track
      SSE live status updates: 5: Customer
      Watch rider GPS pin approach: 5: Customer
      Delivery OTP shown in tracker: 5: Customer
    section Feedback
      48h feedback CTA on delivered tracker: 4: Customer
      Star rating + tag + optional photo: 5: Customer
```

```mermaid
journey
    title Rider journey — Login to delivery
    section Onboard
      Self-register · upload KYC docs: 3: Rider
      Wait for super-admin approval: 2: Rider
      First login post-approval: 5: Rider
    section Shift start
      Go ONLINE on home screen: 5: Rider
      Order pool surfaces nearby READY orders: 4: Rider
      Claim order with payout preview: 5: Rider
    section Pickup
      Navigate to restaurant: 4: Rider
      Mark "reached restaurant": 5: Rider
      Photo proof of pickup: 4: Rider
    section Delivery
      Foreground GPS service emits pings: 4: Rider
      Geofence triggers "reached customer": 5: Rider
      Enter customer's OTP · delivered: 5: Rider
    section Earnings
      Earnings card updates instantly: 5: Rider
      End-of-day payout snapshot: 4: Rider
```

```mermaid
journey
    title Restaurant journey — New order to handoff
    section Receive
      SSE alert · new order tile: 5: Restaurant
      Review items + customer notes: 4: Restaurant
      Accept within 2 minutes: 4: Restaurant
    section Prepare
      KOT shows combo breakdown: 5: Kitchen
      Mark items prepared: 4: Kitchen
      Mark order READY: 5: Kitchen
    section Handoff
      Pool publishes to riders: 5: Restaurant
      Rider claims · arrives · picks up: 4: Restaurant
      Kitchen capacity restored: 5: Kitchen
    section After
      Customer feedback hits drawer: 4: Restaurant
      Low-rated drilldown if needed: 3: Restaurant
```

```mermaid
journey
    title Super-admin journey — Monitor, manage, reconcile
    section Morning
      Live ops dashboard at desk: 5: SuperAdmin
      KYC queue + new restaurant approvals: 4: SuperAdmin
      Pending COD bags from yesterday: 3: SuperAdmin
    section Run
      Watch live map · spot stuck orders: 5: SuperAdmin
      Adjust per-rider payout override: 4: SuperAdmin
      Pause a misbehaving restaurant: 3: SuperAdmin
    section Promote
      Launch coupon campaign: 4: SuperAdmin
      Print QR poster + receipt insert: 5: SuperAdmin
      Configure signup bonus split: 4: SuperAdmin
    section Reflect
      Pull brand-level sales rollup: 5: SuperAdmin
      Review feedback heatmap: 4: SuperAdmin
      Audit log dive on disputed order: 3: SuperAdmin
```

### Design rationale

Every journey shares the same realtime backbone — the customer's order tracker, the rider's delivery shift, the restaurant's kitchen panel, and the super-admin's live map are all subscribed to overlapping SSE channels around the same `Order` row. When status changes, the right people see it in the right surface within a couple hundred milliseconds, without any of them polling.

---

## 11. Appendix

### Scaling roadmap (visual)

```mermaid
gantt
    title Maverick's Food Hub · scaling roadmap
    dateFormat  YYYY-MM
    axisFormat  %b %Y

    section Phase 1 · Single VPS
    Modular monolith on VPS         :done, p1a, 2026-01, 6M
    SSE realtime + local FS         :done, p1b, 2026-01, 6M
    20 restaurants · 5k DAU         :crit, p1c, 2026-04, 3M

    section Phase 2 · Storage split
    R2 object storage adapter swap  :p2a, after p1c, 1M
    Redis session + rate-limit      :p2b, after p1c, 1M
    Cloudflare CDN image transform  :p2c, after p1c, 1M
    100 restaurants · 50k DAU       :p2d, after p2c, 4M

    section Phase 3 · DB + horizontal
    PgBouncer + read replica        :p3a, after p2d, 2M
    Multi-app box load balancing    :p3b, after p2d, 2M
    1000 restaurants · 500k DAU     :p3c, after p3b, 6M

    section Phase 4 · Intelligence
    ML rider dispatch service       :p4a, after p3c, 3M
    Warehouse + feature pipeline    :p4b, after p3c, 3M
    Smart multi-stop routing        :p4c, after p4a, 2M
```

### Design principles (one-liners)

1. **Modular monolith first.** Domains are folders, not services.
2. **Pure resolvers, DB-aware boundaries.** Every domain has a tested pure core + a thin DB-aware wrapper.
3. **State machines, not status fields.** Order, KYC, feedback windows, signup-bonus lifecycle — all explicit graphs.
4. **Idempotency at every external surface.** Webhooks, OTP verification, bonus consumption.
5. **Audit everything, mask everything.** AuditLog row per mutation; secrets never leave the server in plaintext.
6. **Tenants are rows, not databases.** Brand → Restaurant → Branch is a tree of FKs.
7. **Configuration over code for promos.** Nine offer types, three happy-hour shapes, five challenge kinds — all data, no branches in the order machine.
8. **Pluggable externals.** SMS, email, payments, storage, maps — adapter per provider, swap via config.
9. **Real-time is fire-and-forget downstream of DB.** A failed SSE publish never rolls back a paid order.
10. **No premature cloud-native.** Redis enters in Phase 2. K8s never enters unless the math forces it.

### Reference files (for engineers reading this with the codebase open)

| Concern | File |
|---|---|
| Order state machine | `src/server/orders.ts` |
| Offer engine | `src/server/offers.ts` |
| Happy-hour resolver | `src/server/happy-hours.ts` |
| Challenge engine | `src/server/challenges.ts` |
| Signup-bonus engine | `src/server/signup-bonus.ts` |
| Brand rollups | `src/server/brands.ts` |
| Feedback resolver | `src/server/feedback.ts` |
| Alert dispatcher | `src/server/alerts.ts` |
| Category schedules | `src/server/category-availability.ts` |
| KYC validators | `src/server/kyc.ts` |
| Payout overrides | `src/server/payouts.ts` |
| Pricing | `src/server/pricing.ts` |
| Realtime fan-out | `src/server/realtime.ts` |
| Audit log | `src/server/audit.ts` |
| Storage adapter | `src/server/storage.ts` |
| Crypto (AES-256-GCM) | `src/server/crypto.ts` |
| Schema | `prisma/schema.prisma` |

### Rendering this doc

- **GitHub / GitLab / Bitbucket** render Mermaid natively — open the file in the repo viewer.
- **VS Code** with the *Markdown Preview Mermaid Support* extension previews everything.
- **Notion / Obsidian** support Mermaid blocks out of the box.
- **Presentation export** — copy each Mermaid block to [mermaid.live](https://mermaid.live), export as SVG, drop into Keynote / Google Slides / Figma.
- **draw.io / Excalidraw** — each diagram has a parallel `.mmd` file in `docs/diagrams/` ready to import.

---

**End of document.**
