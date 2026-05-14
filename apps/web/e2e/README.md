# E2E test suite

Comprehensive Playwright coverage for the Restaurant Manager web app. The
specs drive real flows (customer order, admin board, rider pool, super-admin
overview, integration wizard, OTP rate limit) against a dev server seeded
with `prisma/seed.ts`.

## Running

```bash
# 1) Make sure the DB is seeded with the standard fixtures. The customer,
#    rider, admin, super-admin, and kitchen accounts in fixtures/auth.ts all
#    come from this seed.
npm run db:seed

# 2) Run the suite. The playwright config has a webServer entry, so this
#    will auto-spawn `npm run dev` and tear it down when the suite finishes.
npm run test:e2e
```

If you already have a dev server running on `http://localhost:3000`,
Playwright reuses it (locally). To skip the auto-spawn entirely, set
`PLAYWRIGHT_NO_SERVER=1`.

To point at a different URL (e.g. a staging deploy):

```bash
BASE_URL=https://staging.example.com PLAYWRIGHT_NO_SERVER=1 npm run test:e2e
```

## Debugging

```bash
# Interactive runner — re-run individual tests, step through, inspect.
npx playwright test --ui

# Headed mode (visible browser, slowed down).
npx playwright test --headed --slow-mo=200

# Run a single spec.
npx playwright test e2e/customer-order.spec.ts

# Show the last HTML report after a failure.
npx playwright show-report
```

Traces are captured on first retry only (see `playwright.config.ts`). To
force a trace on a flaky run, pass `--trace on`.

## What's covered

| Spec                         | Flow                                                                 |
|------------------------------|----------------------------------------------------------------------|
| `customer-order.spec.ts`     | OTP sign-in → add 2 items → checkout COD → tracker shows OTP card    |
| `restaurant-admin.spec.ts`   | Admin walks an order Accept → Preparing → Ready                      |
| `rider-pool.spec.ts`         | Rider toggles online → claims a READY order → Accept → Picked up     |
| `super-admin.spec.ts`        | KPI tiles, restaurants list, live tracking map render                |
| `integrations-wizard.spec.ts`| Razorpay wizard test connection with bogus creds → failure banner    |
| `rate-limit.spec.ts`         | `/api/auth/otp` second-call within 30s → 429 + `retryAfter`          |
| `branding.spec.ts`           | Anon home: "Maverick's Food Hub" wordmark, cuisine marquee, partner CTA |
| `role-isolation.spec.ts`     | Rider session bounced from `/`, `/r/...`, `/profile`, `/checkout` → `/rider`; anon can still reach `/r/saffron-smoke` |
| `tenant-storefront.spec.ts`  | Anon storefront shows "Sign in to order" CTA → `/login?role=customer&next=...`; signed-in customer no longer sees it |
| `role-picker.spec.ts`        | `/login` 4-tile picker (Customer/Rider/Staff/Super Admin), per-tile form swap, `?role=staff` deep link, customer sign-in end-to-end |
| `landing-comprehensive.spec.ts` | Anon `/`: brand, restaurant directory, value-props, footer, mobile reflow |
| `tenant-login.spec.ts`       | `/r/<slug>/login` + `/r/<slug>/staff` flows, admin sign-in lands on `/admin/*`, unknown slug 404 |
| `landing-a11y.spec.ts`       | A11y baseline for `/`: one `<h1>`, accessible names, image alts, no console errors on Tab |
| `sign-in-redesign.spec.ts`   | `/login` split layout (desktop) + stacked (mobile), 4 role tiles swap forms, `?role=customer&next=` redirect |

### Platform / discovery specs (added 2026-05-12)

These lock in the platform-first marketplace rebrand and the role-aware
routing layer:

- **`branding.spec.ts`** — anonymous home must carry the platform brand
  "Maverick's Food Hub", a cuisine marquee on the discovery surface, and a
  "For partners" / "List your restaurant" link in the header. Asserts the
  page is NOT branded as any one restaurant ("Saffron & Smoke" may appear
  as a featured card but never as the wordmark).
- **`role-isolation.spec.ts`** — middleware contract. A signed-in rider is
  pinned to `/rider` — visits to `/`, `/r/<slug>`, `/profile`, `/checkout`
  all redirect back. After sign-out, anonymous users can still load the
  storefront (so we know the rule isn't an over-broad lockdown).
- **`tenant-storefront.spec.ts`** — `/r/saffron-smoke` for an anonymous
  visitor shows a "Sign in to order" CTA whose `href` carries
  `role=customer` and `next=/r/saffron-smoke`. Once the customer signs in,
  the CTA disappears.
- **`role-picker.spec.ts`** — `/login` renders 4 role tiles. Clicking a
  tile reveals the matching form (Staff → email/password, Rider → phone).
  `/login?role=staff` deep-link pre-selects Staff without a click. Also
  drives a full customer sign-in through the picker.

### Premium landing + tenant flows (added 2026-05-12)

These specs cover the premium landing rebuild, the per-restaurant login
routes, and the redesigned `/login` split layout:

- **`landing-comprehensive.spec.ts`** — anonymous `/` carries the "Maverick's
  Food Hub" brand, a restaurant directory section with at least one card,
  three value-prop sections (Customer / Restaurant Owner / Rider — soft
  asserts), and a `<footer>` (`role="contentinfo"`) with nav links. A
  second test re-runs on a 375x667 mobile viewport and asserts no
  horizontal overflow.
- **`tenant-login.spec.ts`** — covers the tenant login surfaces. The
  storefront `/r/saffron-smoke` exposes a "Sign in" CTA pointing at
  `/r/saffron-smoke/login`. The customer-scoped login page references the
  restaurant by name, carries a phone OTP form, and links to the staff
  tab. The staff route `/r/saffron-smoke/staff` carries the
  email/password form; signing in as `admin@restaurant.local` lands on
  `/admin/*` (admin owns Saffron & Smoke). An unknown slug
  (`/r/no-such-restaurant/login`) returns 404 or a graceful not-found
  body.
- **`landing-a11y.spec.ts`** — the a11y baseline for `/`. Exactly one
  `<h1>`. Every visible anchor/button has an accessible name (text,
  `aria-label`, `aria-labelledby`, `title`, or inner `<img alt>`). Every
  `<img>` has an `alt` attribute. Tabbing through the first 10 focusable
  elements raises no console errors or page errors.
- **`sign-in-redesign.spec.ts`** — covers the new `/login` split layout.
  Desktop (1280x800) shows a marketing panel + form panel sitting side by
  side. The form panel exposes four role tiles (Customer, Rider,
  Restaurant Staff, Super Admin) and swaps between the phone and email
  forms when a tile is selected. Mobile (375x667) stacks into a single
  column with no horizontal overflow.
  `/login?role=customer&next=/r/saffron-smoke` pre-selects the customer
  tile, and after a successful OTP sign-in the URL is `/r/saffron-smoke`.

### Platform B2B + customer dashboard + realtime (added 2026-05-12)

These specs lock in the platform-home B2B pivot, the new per-restaurant
customer dashboard, the env-gated Google OAuth button on tenant login, and
the realtime delivery-marker shape on the customer tracker:

- **`platform-home-b2b.spec.ts`** — anonymous `/` is the partner-acquisition
  surface. Asserts no `[aria-label*="cart" i]` is present anywhere on the
  page, no button or link with text "Order now", a "List your restaurant"
  link → `/signup/restaurant`, a "Become a rider" link → `/signup/rider`,
  and a small "Already a partner? Sign in" link with `href` starting
  `/login` and including `role=staff`.
- **`customer-dashboard.spec.ts`** — `/r/saffron-smoke/me` redirects
  anonymous visitors to `/r/saffron-smoke/login`. Signed in as the seeded
  customer it renders a hero greeting (customer name or restaurant name),
  every dashboard section (Wallet, Loyalty, Most ordered, Active offers,
  Recent orders, Saved addresses, Account) via `expect.soft`, and at least
  one KPI tile showing a ₹ value.
- **`google-oauth-presence.spec.ts`** — visits `/r/saffron-smoke/login` and
  branches on `process.env.GOOGLE_CLIENT_ID`: button present when set,
  absent otherwise. Phone OTP form (input `#phone` + Send OTP button) is
  always visible. No actual OAuth handshake.
- **`realtime-marker.spec.ts`** — places a customer order, walks it
  through admin to READY, then claims/accepts/picks-up as the rider (which
  promotes the order to OUT_FOR_DELIVERY). Returns to the customer tracker
  URL and asserts either the ETA pill (`/Arriving in ~\d+ min/`) or the
  map container is in the DOM. Each setup phase is wrapped so a flaky stage
  cleanly `test.skip()`s rather than fails — this spec locks in shape, not
  transition timing (covered by `rider-pool.spec.ts`).

### Rider mobile viewport (added 2026-05-12)

The rider screen is the only surface in the app that ships as a Capacitor
WebView, so it gets its own iPhone-14-Pro-viewport spec to lock the visual
contract independent of the desktop run:

- **`rider-mobile.spec.ts`** — emulates iPhone 14 Pro (`390×844`) via
  `test.use({ viewport: ... })`. Two tests:
  - **Empty state**: signs in as rider, toggles online, asserts the compact
    status strip sits at the top and is ≤80px tall, the empty-state radar
    card is visible, no assignment card is rendered, and there is no
    horizontal overflow.
  - **With an active assignment**: places a fresh COD order as the customer
    in a separate context, walks it to READY as admin, then claims it from
    the rider Pool tab. Back on `/rider`, asserts:
    1. **Exactly one Items section** — no duplicate items strip from the
       pre-rebuild design (counts buttons whose accessible name matches
       `/^\d+ items?\b/i`, expects `1`).
    2. **Map above the fold** — `.leaflet-container` bounding box `top < 600`.
    3. **FAB stack** — four bottom-right buttons (`aria-label` containing
       "Recenter", "Fit", "Layer"/"Map style", "Fullscreen"), each ≥40×40.
    4. **Primary action** — ≥48px tall; label matches the current stage
       ("Accept delivery" / "Mark picked up" / "Enter delivery OTP").
    5. **No horizontal overflow** — `document.documentElement.scrollWidth`
       equals `390`.
    6. **Exactly one Call link** — the customer-card phone CTA appears
       once, not duplicated by a secondary action row.
    7. **FAB reachability** — each FAB click succeeds without
       `window.scrollY` shifting (asserts the controls are in-viewport
       without auto-scroll).
    8. **Sign-out** — opens the avatar account sheet, clicks "Sign out",
       asserts the URL lands on `/login` (with or without `?mode=rider`).

### KYC flows (added 2026-05-13)

The KYC suite locks in the rider self-service KYC screen and the super-admin
review queue. The validator unit suite lives under `__tests__/server/` and is
the source of truth for the document format rules; the two Playwright specs
exercise the user-facing flows end-to-end.

- **`rider-kyc.spec.ts`** — emulates iPhone 14 Pro (390×844). Signs in as the
  seeded rider (`+919876500011`) and asserts:
  1. The account-menu link at `/rider` carries `href="/rider/kyc"` (label
     "Documents · KYC").
  2. `/rider/kyc` renders the hero status banner and exactly the five
     required document cards (Aadhaar, Driving Licence, Vehicle Insurance,
     Vehicle RC, PAN Card).
  3. No element on the page exposes an unmasked 12-digit Aadhaar number —
     `page.locator(':text-matches("\\b\\d{12}\\b")').count()` is zero both
     before and after upload.
  4. Uploading the Aadhaar fixture (`fixtures/dummy-aadhaar.jpg`) with the
     number `234512345678` flips the Aadhaar card to PENDING and shows the
     masked number `XXXX XXXX 5678`.
- **`admin-kyc-review.spec.ts`** — signs in as `super@platform.local`,
  visits `/platform/kyc`, and asserts:
  1. The five KPI tiles render (Pending review, Approved · 30d, Rejected ·
     30d, Expiring · 30d, Expired).
  2. The status filter chips (`All / Pending / Approved / Rejected /
     Expired`) toggle the `?status=` URL parameter.
  3. Clicking a pending row opens the review drawer (`role="dialog"`).
     The drawer shows a masked number in one of the per-type formats
     (`XXXX XXXX ####`, `XXXXX####`, etc.), a doc preview region (`<img>`,
     `<iframe>`, or unsupported-fallback), and Approve + Reject buttons.
  4. Clicking Reject reveals a `<textarea>` — the "Submit rejection" button
     stays disabled while empty, becomes enabled when a reason is typed,
     and closes the drawer on submit. The spec auto-skips this second test
     when no PENDING rows exist (so a stale seed doesn't blow up the suite).

The validator unit suite lives at `__tests__/server/kyc.test.ts` and covers
`validateAadhaar`, `validateLicense`, `validatePan`, `validateInsurance`,
`validateExpiry`, and `getStatusSummary` (with a hoisted Prisma mock). Run
it via:

```bash
npm run test -- --run __tests__/server/kyc.test.ts
```

## Fixtures

`fixtures/auth.ts` exposes:

- `signInAsCustomer(page)` — OTP sign-in via UI, reads `devCode` from
  `/api/auth/otp` JSON instead of scraping logs.
- `signInAsRider(page)` — same path, rider phone.
- `signInAsAdmin(page)` — email + password.
- `signInAsSuperAdmin(page)` — email + password.
- `signInAsKitchen(page)` — email + password.
- `requestOtp(request, phone)` — low-level helper to grab a code for ad-hoc
  flows. Throws on rate-limit so flakes are loud.
- `expectMeRole(page, role)` — verifies `/api/me` reflects the expected role.

Specs are self-contained — each `beforeEach` re-authenticates. There's no
explicit cleanup because the seed is idempotent and order data is
non-destructive.
