# Flavrly — Production QA Test Plan

A handoff guide for the tester. Covers **what** to test, **where**, **how**, and **why**, plus the production-readiness gate. Read sections 1–2 first; they change *how* you test everything else.

---

## 1. Before you start — environment & safety (read this first)

Flavrly is a **live food-ordering platform**. Testing carelessly on production can place real orders, send real SMS (cost), and move real money. Decide the environment up front:

| Concern | Guidance |
|---|---|
| **Where to test** | Prefer a **staging build** identical to prod. If only production is available, use a dedicated **test restaurant** and only **COD** orders you can cancel — never test card payments against a live gateway. |
| **Payments** | Confirm whether the payment gateway is in **test/sandbox mode**. If it's live, do **not** test online payments — test COD only and have an admin cancel test orders. |
| **OTP / SMS** | The app has an **OTP demo mode** (codes shown in the API response/logs, no real SMS). Confirm which mode is active. In demo mode you read the code from the response; in live mode a real phone is needed. |
| **Test data** | Ask for a **seeded test tenant** (restaurant + branches + menu + a test rider + a test customer). Don't pollute real restaurant data. |
| **Build under test** | Confirm the **deployed commit/date**. Several features were recently built; make sure you're testing the intended build (ask the dev for the live version). |
| **Roles/accounts** | You need credentials for **every role** (see §3). Never test super-admin destructive actions on real tenants. |

---

## 2. Test accounts to provision (ask the dev for these)

- **Customer** — a phone number you control (for OTP), with at least one saved address.
- **Restaurant Admin** — for a *test* restaurant (so you can break things safely).
- **Kitchen** staff login (same test restaurant).
- **Rider** — phone + the installed Android rider app build (APK).
- **Super Admin** — platform access (use read-only-ish flows; avoid destructive prod actions).
- A **second test restaurant** to verify multi-tenant isolation (one tenant must never see another's data).

---

## 3. Surfaces & where to test (role → URL map)

| Surface | Who | Where |
|---|---|---|
| **Customer site / PWA** | Eaters | `flavrly.in` (home), `/restaurants` (discovery), `/r/<slug>` (storefront), `/cart`, `/checkout`, `/orders`, `/track`, `/profile/*` |
| **Restaurant Admin** | Owner/manager | `flavrly.in/admin/*` (dashboard, orders, menu, offers, settings, reports, etc.) |
| **Kitchen** | Kitchen staff | the kitchen order board |
| **Super Admin / Platform** | Operator | `flavrly.in/platform/*` (dashboard, restaurants, orders, riders, KYC, COD, payouts, reports, security, rider-ops) |
| **Rider app** | Delivery riders | Android app (login → online → claim → pickup → deliver → earnings) |

Test on **mobile and desktop** for every web surface — the customer site is **mobile-first / installable PWA**.

---

## 4. Functional test areas (what + how + why)

For each: verify the happy path, the error path, and that the result **persists** (reload the page / check the other role's view).

### 4.1 Customer ordering (highest priority — this is revenue)
- **Discovery & location**: set delivery location (current location, map pin, saved address); only in-range restaurants show. *Why: wrong radius = lost or undeliverable orders.*
- **Storefront**: menu loads, categories/variants/modifiers, veg/non-veg, happy-hour strike-through prices, FSSAI licence footer, offers carousel.
- **Cart**: add/remove/qty, variants & add-ons priced correctly, packaging fee, savings celebration popup (**desktop + mobile**), coupon/offer apply (auto + by code), BOGO offers.
- **Checkout**: fulfillment type (delivery / pickup / dine-in), scheduled order, address, payment method (**COD safe**), final total = subtotal − discounts + tax + delivery + packaging. *Why: any pricing mismatch is a trust/financial bug.*
- **Order placement → tracking**: order appears in `/orders` and `/track`; live status + rider on map; delivery OTP shows.
- **Post-order**: reorder, favorites, feedback/rating, signup-bonus/rewards ledger.
- **Auth**: signup/login via OTP, Google OAuth, single-active-session (logging in elsewhere logs out the first device).

### 4.2 Restaurant Admin
- **Orders board**: new orders arrive **in real time** (no refresh); accept/reject/preparing/ready transitions persist and reflect on the customer tracker + kitchen.
- **Menu**: CRUD categories/items/variants/modifiers, availability toggle, image upload, CSV/Excel import-export, category scheduling.
- **Offers / Coupons / BOGO / Happy Hours / Combos / Freebies / Challenges / Cross-sell**: create each, confirm it actually applies in a customer cart/checkout.
- **Settings**: branding, branches (address, hours, fees, packaging fee, **FSSAI food licence** upload + expiry), integrations, order-flow toggles.
- **Reports**: numbers match orders; CSV/XLSX downloads open correctly.
- **Reservations / Tables** (if dine-in enabled).

### 4.3 Kitchen
- New/Received → Accept; live board updates; KOT; sound/attention on new order.

### 4.4 Super Admin / Platform (operator control plane)
- **Dashboard / Analytics**: KPIs and charts reflect real orders.
- **Restaurants**: approve/reject/suspend, create via wizard, assign to brand/parent.
- **Orders / Live tracking**: global order list + filters + export; live rider GPS map updates.
- **Riders / KYC / COD / Payouts**: rider roster + approve applications; KYC approve/reject; COD reconcile/collect/waive; publish payout rules.
- **Users**: search, wallet adjust.
- **Security**: TOTP 2FA setup + enforced login; failed-login log.
- **System health / Observability / Audit log**: real probes, error logs, audit trail.
- **Rider ops**: messages (rider⇄platform), SOS alerts, incidents, support, training modules, shifts, surge zones, tiers, referrals, incentives.

### 4.5 Rider app (Android)
- Login (phone→OTP), go online, see order pool, claim, navigate, pickup, capture proof-of-delivery photo, deliver with OTP, earnings, KYC upload, SOS button, messages, push notifications + sound on new order.

---

## 5. Cross-cutting / non-functional (the "every corner" part)

- **Realtime**: open the same order on customer tracker + admin board + kitchen + rider app simultaneously — a status change on one must reflect on all within seconds (SSE). Test with a flaky/slow network too (it should fall back to polling, not break).
- **Multi-tenant isolation**: as Restaurant A's admin, confirm you **cannot** see Restaurant B's orders/menu/reports. Critical security check.
- **Responsive / mobile / PWA**: every customer page on a real phone; install the PWA; back/forward nav; offline behaviour; no horizontal scroll or cut-off content.
- **Performance**: home + storefront load on a mid-range phone on slow data; hero video must not block load; images lazy-load.
- **Security**: try accessing `/admin/*` and `/platform/*` while logged out or as a customer (must be blocked); try acting on another tenant's records via guessed IDs; verify no secrets/keys in network responses; OTP rate-limiting on repeated requests.
- **Payments & COD**: COD reconciliation math; refund/cancel paths; never expose card data.
- **Data integrity**: totals, taxes, discounts, payout amounts — recompute by hand on a few orders and confirm they match.
- **Notifications**: order confirmations, status updates, OTP — sent on the right events (SMS/email/push).
- **Accessibility (basic)**: keyboard navigation, focus states, alt text, colour contrast on key flows.
- **SEO/metadata** (customer pages): titles, share previews.
- **Error handling**: invalid inputs, expired sessions, network drops, double-submit (e.g. double-tap "Place order") must not double-charge or duplicate.

---

## 6. Test types & cadence

1. **Smoke** (15 min): home loads, login works, place 1 COD order end-to-end, admin sees it, status flows to delivered.
2. **Functional**: walk every checklist in §4 per role.
3. **Cross-role E2E**: one real order observed across customer → kitchen → admin → rider → delivered, watching realtime.
4. **Regression**: after each fix/deploy, re-run smoke + the area that changed.
5. **Exploratory** (timeboxed): try to break it — weird inputs, rapid clicks, back-button mid-flow, two tabs.
6. **UAT sign-off**: the business confirms the flows match expectations.

---

## 7. Bug reporting format (use this for every issue)

```
Title:        <short, specific>
Surface/URL:  <where>
Role:         <customer / admin / kitchen / super-admin / rider>
Device/Browser: <e.g. iPhone 13 Safari / Pixel Chrome / Desktop Chrome>
Build/Time:   <deployed version + timestamp>
Steps:        1… 2… 3…
Expected:     <what should happen>
Actual:       <what happened + screenshot/video>
Severity:     Blocker / Critical / Major / Minor / Cosmetic
```

**Severity guide:** *Blocker* = can't order/pay or data loss/security; *Critical* = core flow broken for many; *Major* = feature broken with workaround; *Minor* = small functional issue; *Cosmetic* = visual only.

---

## 8. Known gaps — do NOT log these as bugs (yet)

These are known and either intentional or in-progress; flagging them wastes the tester's time:

- **OTP demo mode** banner/log line — intentional until launch (real SMS gets switched on at go-live).
- **Rider economics not fully wired**: rider **incentives don't pay out**, **surge multipliers don't yet affect pay**, **rider tiers/perks aren't enforced**, **referrals don't progress past pending**, **shift "Missed" never triggers** — these are configurable in the platform UI but the downstream effects are being built. Verify the *admin CRUD* works; don't expect the payout/enforcement yet.
- **Platform → QR codes** page renders a placeholder (no scannable image / download yet).
- **Platform → Users "Suspend"** does not truly suspend yet; **impersonate** isn't built.
- **Order refunds** from the platform Orders drawer are display-only (no refund action yet).
- Confirm the **deployed build** with the dev — recently built features (e.g. BOGO offers, food-licence, banner carousel) may not be live until deployed.

(Ask the dev to confirm this list before the session so it's current.)

---

## 9. Production go-live checklist (gate before launch)

- [ ] OTP/SMS switched to a **real provider**, demo mode **off**.
- [ ] Payment gateway in **live** mode with verified keys; one real low-value transaction reconciled.
- [ ] Email (SMTP) sending real confirmations.
- [ ] All restaurant **FSSAI licences** uploaded + not expired; expiry alerts firing.
- [ ] Backups scheduled and a **restore tested**.
- [ ] Error log / observability quiet of new errors after deploy.
- [ ] Super-admin **2FA enabled**.
- [ ] Multi-tenant isolation verified.
- [ ] Smoke test green on production with a real device.
- [ ] Rollback plan known (how to redeploy the last good build).

---

## 10. What was missing from the original request (so you brief the tester well)

Your request said "test every corner for production" — these are the points it didn't specify but **must** be decided, or the test will be unsafe/incomplete:

1. **Which environment** (staging vs production) and whether payments/SMS are in test mode — otherwise the tester risks real charges/SMS spend.
2. **Test accounts & data** for all five roles (incl. the Android rider APK) and a throwaway test restaurant.
3. **Device/browser matrix** (which phones/browsers you officially support) — without this, "responsive" is undefined.
4. **The rider Android app** is a separate surface from the website and needs its own device + install.
5. **Multi-tenant isolation** and **role-based access control** — security tests that are easy to forget but business-critical for a marketplace.
6. **Known-gaps list** (§8) so the tester doesn't file in-progress features as bugs.
7. **Severity/triage scheme + a single bug tracker** so issues are actionable.
8. **Performance/load expectations** (e.g. peak lunch/dinner concurrency) if you expect volume at launch.
9. **Data privacy**: PII (phones, addresses) and FSSAI documents — confirm the tester handles test data, not real customer data.
10. **Go-live gate owner** — who signs off that production is ready (§9).
```
