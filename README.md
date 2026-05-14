# Restaurant Manager — Food Ordering Platform

A complete, production-grade food ordering ecosystem for restaurants. Built with Next.js 15, TypeScript, Postgres, Prisma, Tailwind, and shadcn/ui. Four surfaces in one deployable app:

- **Customer site** — browse, cart, checkout (Razorpay/COD), real-time order tracking, profile, addresses, reorder.
- **Admin dashboard** — KPIs, live orders, accept/reject, rider assignment, KOT/invoice print, full menu/combo/branch/user CRUD, exportable analytics.
- **Kitchen panel** — touch-friendly order board, prep timers, KOT printing.
- **Rider console (PWA)** — OTP login, assigned orders, navigation/call, delivery OTP verification, GPS streaming, earnings.

Every "future enhancement" from the spec is scaffolded: loyalty points, wallet, referrals, multi-branch, inventory, live GPS tracking, distance-based rider allocation (with hooks for ML).

## Quick start

```bash
# 1. Boot Postgres + the app
docker compose up --build

# Or, locally (requires Node 20+ and Postgres 15+):
cd apps/web
cp .env.example .env       # edit DATABASE_URL etc
npm install                # uses --legacy-peer-deps automatically (.npmrc)
npm run db:push            # apply schema
npm run db:seed            # insert sample restaurant + menu + users
npm run dev                # http://localhost:3000
```

Default seed credentials (change immediately in production):
- Admin: `admin@restaurant.local` / `Admin@12345`
- Kitchen: `kitchen@restaurant.local` / `Kitchen@12345`
- Customer / Rider: log in via OTP — in dev mode the OTP is logged to the server console.

## Surfaces

| Path | Surface | Auth |
|---|---|---|
| `/` | Customer site | OTP (mobile) |
| `/admin` | Admin dashboard | Email/password (role: ADMIN) |
| `/kitchen` | Kitchen panel | Email/password (role: KITCHEN) |
| `/rider` | Rider console | OTP (mobile) |

## Architecture in one paragraph

Single Next.js 15 App Router app, route-grouped by surface (`(customer)`, `admin`, `kitchen`, `rider`). All four surfaces share one Postgres database via Prisma. Server Actions + a thin REST/SSE API. Server-Sent Events fan out order/status updates to every interested surface. Razorpay, Twilio (SMS/WhatsApp), Google Maps, and S3 are accessed through interface adapters with mock implementations for local dev — swap real keys at deploy time. Mobile-first responsive UI with shadcn/ui + Tailwind; rider console ships as an installable PWA. Docker + docker-compose for any-host deploys (Vercel, Railway, Render, AWS, GCP, self-hosted).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the deeper dive, [docs/DEPLOY.md](docs/DEPLOY.md) for hosting recipes, and [docs/ROADMAP.md](docs/ROADMAP.md) for the future-features status.

## Repo layout

```
.
├── apps/web/                  Next.js 15 app (all 4 surfaces)
│   ├── src/
│   │   ├── app/
│   │   │   ├── (customer)/    Customer site routes
│   │   │   ├── admin/         Admin dashboard
│   │   │   ├── kitchen/       Kitchen panel
│   │   │   ├── rider/         Rider console (PWA)
│   │   │   └── api/           REST + SSE endpoints
│   │   ├── components/        UI components (shadcn-derived + custom)
│   │   ├── lib/               Pure utilities (currency, dates, validators…)
│   │   ├── server/            Server-only modules: db, auth, payments, notifications, realtime, analytics
│   │   ├── hooks/             Client-side React hooks
│   │   └── types/             Shared TS types
│   ├── prisma/                Schema, migrations, seed
│   ├── tests/                 Vitest + Playwright
│   └── public/                Static assets, PWA manifest, icons
├── docs/                      Architecture, deploy, API, roadmap
├── scripts/                   Dev helpers
├── docker-compose.yml         Postgres + app
└── Dockerfile                 Production image
```

## License

MIT.
