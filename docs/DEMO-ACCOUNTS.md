# Oak & Sizzler — Demo Accounts

Every role, for every seeded restaurant, with login details and what each
account can explore. Generated from the seed data (`seed-brand-mavericks.ts` +
`seed-rider-features.ts`).

> **To populate these on a fresh database**, from `apps/web`:
> ```
> npm run db:seed:cuisines        # the 7 restaurants, menus, orders, staff, riders, customers
> npm run db:seed:rider-features  # super-admin, rider avatars, KYC document images, live pool orders
> ```
> `seed-rider-features.ts` prints this same directory to the console when it finishes.

---

## How each role signs in

| Role | Where | Method |
|---|---|---|
| **Super Admin** | Web `/login` → "Super Admin" tile | Email + password |
| **Restaurant Admin** | Web `/login` → "Restaurant Staff" tile | Email + password |
| **Kitchen** | Web `/login` → "Restaurant Staff" tile | Email + password (routes to `/kitchen` by role) |
| **Customer** | Web `/login` → "Customer" tile | Phone + OTP |
| **Rider** | **Native Android app** (Oak & Sizzler Rider) | Phone + OTP |

**OTP:** the VPS runs with `OTP_DEBUG_LOG=true`, so after "Send code" the OTP is
returned in the API response (the rider app's verify screen shows it) and also
logged — `pm2 logs rm-web` shows `OTP issued (dev) … code=######`.

Riders enter the **10-digit** number (the app prepends `+91`). e.g. for
`+919875294185`, type `9875294185`.

---

## Platform

| Role | Email | Password |
|---|---|---|
| Super Admin | `super@platform.local` | `Super@12345` |

Sees: all 7 restaurants, every order, the full rider fleet, payouts, incentives,
surge zones, tiers, referrals, SOS alerts, incidents, shifts, training modules,
live tracking (`/platform/live` — every online rider on the map), and messaging
(`/platform/messages` — chat with any rider).

---

## Restaurants

Each restaurant has **1 admin, 1 kitchen user, 2 customers, 3 riders**. Admins
manage menu/orders/branches/dedicated-riders/safety/messages/reports; kitchen
sees the live order board; customers have order history + saved addresses;
riders have KYC documents (with images), a profile photo, and appear in the pool.

All staff passwords: **admin `Admin@12345`**, **kitchen `Kitchen@12345`**.
All customer & rider logins are **phone + OTP** (no password).

### Mozza Italia
*Dispatch mode: DEDICATED_FIRST — Riders 1 & 2 are dedicated to this restaurant.*

| Role | Login |
|---|---|
| Admin | `admin@italia-pizza.maverickfoodhub.com` / `Admin@12345` |
| Kitchen | `kitchen@italia-pizza.maverickfoodhub.com` / `Kitchen@12345` |
| Customer A | `+919870294185` |
| Customer B | `+919871294185` |
| Rider 1 (dedicated) | `+919875294185` |
| Rider 2 (dedicated) | `+919876294185` |
| Rider 3 | `+919877294185` |

### Biryani Zone

| Role | Login |
|---|---|
| Admin | `admin@biryani-zone.maverickfoodhub.com` / `Admin@12345` |
| Kitchen | `kitchen@biryani-zone.maverickfoodhub.com` / `Kitchen@12345` |
| Customer A | `+919870910923` |
| Customer B | `+919871910923` |
| Rider 1 | `+919875910923` |
| Rider 2 | `+919876910923` |
| Rider 3 | `+919877910923` |

### Bowl and Barbeque

| Role | Login |
|---|---|
| Admin | `admin@bowl-and-barbeque.maverickfoodhub.com` / `Admin@12345` |
| Kitchen | `kitchen@bowl-and-barbeque.maverickfoodhub.com` / `Kitchen@12345` |
| Customer A | `+919870657452` |
| Customer B | `+919871657452` |
| Rider 1 | `+919875657452` |
| Rider 2 | `+919876657452` |
| Rider 3 | `+919877657452` |

### Hotel Siddhartha

| Role | Login |
|---|---|
| Admin | `admin@hotel-siddhartha.maverickfoodhub.com` / `Admin@12345` |
| Kitchen | `kitchen@hotel-siddhartha.maverickfoodhub.com` / `Kitchen@12345` |
| Customer A | `+919870534211` |
| Customer B | `+919871534211` |
| Rider 1 | `+919875534211` |
| Rider 2 | `+919876534211` |
| Rider 3 | `+919877534211` |

### Wok and Sizzler

| Role | Login |
|---|---|
| Admin | `admin@wok-and-sizzler.maverickfoodhub.com` / `Admin@12345` |
| Kitchen | `kitchen@wok-and-sizzler.maverickfoodhub.com` / `Kitchen@12345` |
| Customer A | `+919870152979` |
| Customer B | `+919871152979` |
| Rider 1 | `+919875152979` |
| Rider 2 | `+919876152979` |
| Rider 3 | `+919877152979` |

### Party Place

| Role | Login |
|---|---|
| Admin | `admin@party-place.maverickfoodhub.com` / `Admin@12345` |
| Kitchen | `kitchen@party-place.maverickfoodhub.com` / `Kitchen@12345` |
| Customer A | `+919870950240` |
| Customer B | `+919871950240` |
| Rider 1 | `+919875950240` |
| Rider 2 | `+919876950240` |
| Rider 3 | `+919877950240` |

### Cuisine of Andhra

| Role | Login |
|---|---|
| Admin | `admin@cuisine-of-andhra.maverickfoodhub.com` / `Admin@12345` |
| Kitchen | `kitchen@cuisine-of-andhra.maverickfoodhub.com` / `Kitchen@12345` |
| Customer A | `+919870921677` |
| Customer B | `+919871921677` |
| Rider 1 | `+919875921677` |
| Rider 2 | `+919876921677` |
| Rider 3 | `+919877921677` |

---

## Quick reference — all staff logins

| Restaurant | Admin email | Kitchen email |
|---|---|---|
| Mozza Italia | `admin@italia-pizza.maverickfoodhub.com` | `kitchen@italia-pizza.maverickfoodhub.com` |
| Biryani Zone | `admin@biryani-zone.maverickfoodhub.com` | `kitchen@biryani-zone.maverickfoodhub.com` |
| Bowl and Barbeque | `admin@bowl-and-barbeque.maverickfoodhub.com` | `kitchen@bowl-and-barbeque.maverickfoodhub.com` |
| Hotel Siddhartha | `admin@hotel-siddhartha.maverickfoodhub.com` | `kitchen@hotel-siddhartha.maverickfoodhub.com` |
| Wok and Sizzler | `admin@wok-and-sizzler.maverickfoodhub.com` | `kitchen@wok-and-sizzler.maverickfoodhub.com` |
| Party Place | `admin@party-place.maverickfoodhub.com` | `kitchen@party-place.maverickfoodhub.com` |
| Cuisine of Andhra | `admin@cuisine-of-andhra.maverickfoodhub.com` | `kitchen@cuisine-of-andhra.maverickfoodhub.com` |

Admin password `Admin@12345` · Kitchen password `Kitchen@12345` for all rows.

---

## Notes

- **Rider demo data:** every rider has an AI-styled profile avatar and a full
  set of KYC documents (Aadhaar, Driving Licence, Vehicle RC, Vehicle Insurance,
  PAN) — mock specimen images, viewable in the app's Profile → My Documents.
- **Live pool:** `seed-rider-features.ts` seeds `READY` unassigned orders across
  all restaurants so the rider app's Orders pool is never empty.
- **Customers** can browse and order at `/r/<restaurant-slug>` (e.g.
  `/r/italia-pizza`).
- These are demo credentials for a non-production environment. Rotate or remove
  before any real launch.
