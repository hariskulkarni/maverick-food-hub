# Responsive audit — 116 surfaces · ~210 issues

Audit completed 2026-06-01 against the apps/web/src tree on the Restaurant Manager / Flavrly Next.js 15 app. Scope: every `page.tsx` under `apps/web/src/app/**`, the four shell layouts, and shared components under `components/admin/`, `components/storefront/`, `components/mobile/`. Methodology: surface-level scan + obvious co-located clients (`*-client.tsx`, `*-board.tsx`, `*-editor.tsx`, `explorer.tsx`, `form.tsx`). Defect numbers refer to the 12-point checklist in the brief.

## Summary
- Customer surfaces: 38 audited, 26 clean, 12 with issues (mostly P2 polish)
- Admin surfaces: 35 audited, 14 clean, 21 with issues (mostly P1)
- Platform surfaces: 41 audited, 5 clean, 36 with issues (heavy P1 — tables + sidebar)
- Kitchen surfaces: 2 audited, 2 clean
- Root + demo-gate: 2 audited, 2 clean
- Severity: **~25 P0** (customer-visible) / **~155 P1** (admin/operator-blocking — dominated by the unresponsive sidebars and tables) / **~30 P2** (polish, tiny-text, intentional pill grids)

## Foundation primitives needed (extracted from recurring defects)

These primitives recur across 3+ surfaces and should be built before the fix waves so the refactor is mechanical, not bespoke.

- **AdminShell / PlatformShell** — collapsing sidebar layout. Used by `admin/layout.tsx` and `platform/layout.tsx`; the current `grid grid-cols-[240px_1fr]` with persistent `<aside>` is invisible on phones (no `hidden md:block`, no drawer toggle). Affects every admin + platform surface — ~75 routes get a shell win for free.
- **ResponsiveTable** — `<table>` wrapped in `overflow-x-auto` is the dominant pattern (28 instances across platform/admin) but there's no mobile-card fallback. Replace with a primitive that renders rows as stacked cards under `md:`. Highest-impact tables: `platform/orders/explorer.tsx`, `platform/kyc/kyc-queue-client.tsx`, `platform/audit-log/audit-client.tsx`, `platform/feedback/feedback-client.tsx`, `platform/cod/cod-client.tsx`, `platform/rider-*` (8 surfaces), `admin/coupons/coupons-client.tsx`, `admin/offers/offers-client.tsx`, `admin/feedback/feedback-client.tsx`, `admin/safety/rider-safety-client.tsx`, `admin/challenges/challenges-client.tsx`, `admin/menu/import-export-panel.tsx`, `admin/riders/dedicated-riders-client.tsx`, `admin/reports/reports-workspace.tsx`.
- **ResponsiveDrawer** — `components/admin/detail-drawer.tsx` is already responsive (`width: 100%, maxWidth: width`) but every consumer passes `width="560px"`/`"640px"`/`"680px"`/`"720px"`/`"900px"`. On phones the modal fills the viewport, which is fine, but the prop name "width" is misleading and several drawers contain horizontal forms that don't stack. Wrap in a primitive that swaps to a bottom sheet on `< md`. Consumers: kyc, rider-support, restaurants (680px), audit-log (900px — widest), training-modules, users, rider-incidents, riders, orders, live-ops, cod, rider-sos, support (13 instances).
- **FilterBar** — `flex flex-wrap items-center gap-3` with a `min-w-[240px] max-w-md` search input, several `select`s, and chip rows. Pattern repeats verbatim across platform/orders, platform/restaurants, platform/users, platform/riders, platform/audit-log, platform/brands, platform/kyc, platform/observability, admin/coupon-campaigns, admin/cross-sell, admin/challenges, admin/offers, admin/combos, admin/happy-hours (14+ instances). The `min-w-[240px]` is dangerously close to a 360px viewport — on phones the search input alone takes a full row and chip groups wrap awkwardly. Primitive should drop `min-w-*` under `sm:` and stack groups.
- **FormGrid** — `grid grid-cols-N` (N = 2/3/4) without a `sm:` or `md:` qualifier on form rows is the second-most-common defect. Used by `admin/branches/new/form.tsx`, `admin/storefront/storefront-editor.tsx` (color inputs), `platform/payouts/editor.tsx`, `platform/restaurants/new/wizard-client.tsx`, `admin/offers/offer-editor.tsx`. Primitive: `<FormGrid cols={3}>` that resolves to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.
- **MobileSidebar / NavDrawer** — companion to AdminShell. A radix Sheet triggered by a hamburger in the header; same nav list. Used 2x (admin + platform layouts) but it cascades to every route inside those shells.

## Surface-by-surface findings

### CUSTOMER

#### / (home)  (P2)
- [11] `text-[10px]` cart-button badge — minor.

#### /restaurants  (P2)
- [11] `text-[10px]` chip labels on storefront preview rows — small.
- Otherwise excellent: `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` on cards, sticky filter chip rail with mobile overrides.

#### /r/[slug]  (P2)
- [11] `text-[10px]` BESTSELLER + HAPPY HOUR badges (intentional, fits design).
- Top sellers grid `md:grid-cols-4` — fine on mobile (1-col), `<h-36>` images may feel tight at 4-col on tablet.

#### /r/[slug]/me  (P2)
- [4] `grid grid-cols-3 gap-3` stat row at line 227 of `me-client.tsx` (no responsive qualifier) — but each cell is small KPIs, OK at 360px.

#### /r/[slug]/reserve  (clean)
#### /r/[slug]/login  (clean)
#### /r/[slug]/staff  (clean)
#### /r/[slug]/me/reservations  (clean)

#### /menu  (clean)
- Dual sidebar pattern (`hidden md:block` + mobile sticky jumpnav) is the gold-standard reference.

#### /cart  (P2)
- [11] `text-[10px]` "+ taxes & delivery" hint — minor.
- Sidebar correctly `hidden md:block`, sticky `md:top-20`.

#### /checkout  (clean)
- Uses `sm:grid-cols-2`, `md:grid-cols-[1fr_360px]`, `md:sticky md:top-20`.

#### /combos  (clean)
#### /category/[slug]  (clean)
#### /brand/[slug]  (clean)

#### /orders  (P2)
- [1] `min-w-[200px]` filter wrapper — wraps cleanly on phone, OK.

#### /orders/[id]  (P0)
- [4] `grid grid-cols-5` 5-step progress tracker at line 466 of `tracker-client.tsx` — intentional for the visual progress bar but labels overflow.
- [4] `grid grid-cols-3` at line 721 of `tracker-client.tsx` — meta strip, OK at 360px.
- [11] `text-[10px]` step labels.

#### /track  (clean)
#### /login, /signup/restaurant, /signup/rider  see below

#### /signup/restaurant  (P1)
- [4] `grid grid-cols-3` step indicator at `page.tsx:24` — short labels, fine.
- [4] `grid grid-cols-4` password-strength meter at `form.tsx:237` — narrow bars, OK.
- [1] `max-w-[180px]` on phone-step container — fits within 360px.

#### /signup/rider  (clean)
#### /login  (clean)

#### /profile (root)  (P2)
- [11] `text-[10px]` Active badge.

#### /profile/rewards  (P2)
- [11] tiny badges.

#### /profile/security  (P2)
- [11] tiny session badges.

#### /profile/signup-bonus  (P2)
- [11] `text-[10px]` history rows.

#### /profile/favorites, /profile/addresses, /profile/addresses/new, /profile/referrals  (clean)

#### /rider-app  (P1)
- [4] `grid grid-cols-3 gap-6` stats strip at `page.tsx:170` (no `sm:` qualifier) — three KPIs may compress on 360px.
- [4] `grid grid-cols-4` in `earnings-calculator.tsx:72,96` — intentional pill choosers, short labels.
- [1] `max-w-[280px]` phone mockup, `max-w-[360px]` install guide, `max-w-[200px]/[220px]` tutorial captions — all fit < 380px.
- [11] tiny mockup labels (intentional inside fake phone screen).

#### Marketing legal pages — /about, /careers, /contact, /privacy, /terms, /refunds, /faq, /cookies  (clean)

### ADMIN

#### admin/layout.tsx  (P1 — systemic)
- [3] **`grid grid-cols-[240px_1fr]` with persistent `<aside>` and no mobile collapse.** Sidebar takes 240px of 360px viewport on every single admin route. No hamburger trigger, no `hidden md:flex`. This is the single biggest blocker for the admin surface.

#### /admin (dashboard)  (P1)
- [2] inline `<table>` at line 87 for child-breakdown — no overflow wrapper.
- [11] `text-[10px]` parent badge.

#### /admin/orders  (P1)
- [10] `sticky top-0 z-30 -mx-6` toolbar on `orders-board.tsx:299` — sticky offset assumes desktop padding; on mobile it sits under the (hidden) sidebar.

#### /admin/menu  (P1)
- [1] `min-w-[120px..180px]` on many inputs in `variant-modifier-editor.tsx` and `menu-manager.tsx` — adds up on phone.
- [2] table at `import-export-panel.tsx:190` — has `overflow-x-auto`.

#### /admin/branches  (P1)
- [4] `grid grid-cols-3 gap-3 text-sm` stat strip at `page.tsx:28` (no `sm:` qualifier) — three text stats squeezed.

#### /admin/branches/new  (P1)
- [4] `grid grid-cols-3 gap-3` city/state/PIN at `form.tsx:38` — 3 inputs on phone is unusable.
- [4] `grid grid-cols-4 gap-3` tax/fee row at `form.tsx:47` — 4 number inputs in 360px = each <90px wide.
- [6] no `flex-col` fallback on grouped fields.

#### /admin/settings  (P2)
- [11] tiny status badges throughout `integration-wizard.tsx`, `notifications-table.tsx`, `integrations-section.tsx`.
- Form grids correctly use `md:grid-cols-2/4`.

#### /admin/settings/order-flow  (clean)

#### /admin/storefront (Design)  (P1)
- [1] Many hard-coded `w-[140px]`, `w-[120px]`, `w-[320px]`, `w-[110px]`, `w-[160px]` on inputs in `storefront-editor.tsx` — color pickers and selects don't shrink.
- [10] `sticky bottom-4 z-10` save bar — collides with `<StickyCartBar>` on customer side but only admin-visible so OK.
- [11] `text-[10px]` preview labels.

#### /admin/storefront/menu, /admin/storefront/integrations  (clean — reuse workspaces)

#### /admin/storefront/promotions/*  (clean — listing pages, reuse client tables)

#### /admin/coupons  (P1)
- [2] table at `coupons-client.tsx:130` — has overflow-x-auto, no card fallback.
- [1] `max-w-[280px]` truncated description.
- [11] `text-[10px]` Expired badge.

#### /admin/coupon-campaigns  (P1)
- [1] `min-w-[180px]` search.
- [11] tiny code/discount mini-labels.
- [4] `grid grid-cols-2 md:grid-cols-4` KPI strip — fine.

#### /admin/coupon-campaigns/[id]/reports  (P1)
- [4] `grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7` KPI strip — at lg:7 it crams 7 cards. At 360px collapses to 2-col which is fine.
- [2] table at line 239.
- [11] `text-[10px]` channel badges.

#### /admin/coupon-campaigns/[id]/qr-poster  (P2)
- [9] fixed `width={400}` QR — intentional poster size.

#### /admin/offers  (P1)
- [4] `grid grid-cols-3 gap-2` in `offer-editor.tsx:745,793` — no `sm:` qualifier.
- [2] table at `offers-client.tsx:235`.
- [1] `min-w-[180px]` search.
- [11] tiny Auto/Stackable badges.

#### /admin/happy-hours  (P1)
- [1] `min-w-[180px]` search.
- [10] sticky bottom-0 form footer in `rule-editor.tsx:587` — overlaps mobile chrome.
- [11] tiny Priority labels.

#### /admin/cross-sell  (P1)
- [1] `min-w-[180px]` search.
- [11] tiny badges.

#### /admin/challenges  (P1)
- [1] `min-w-[180px]` search; `w-[180px]` table cell.
- [2] table at `challenges-client.tsx:473` (`text-xs` already).
- [10] sticky bottom form footer in `challenge-editor.tsx:435`.

#### /admin/combos  (P2)
- [1] `min-w-[180px]` search.
- [11] tiny status badges.

#### /admin/freebies  (clean — defers to listing)

#### /admin/feedback  (P1)
- [2] table at `feedback-client.tsx:159`.
- [1] `max-w-[260px]` truncated cells.
- [11] tiny tag badges.

#### /admin/activity  (P2)
- [11] `text-[10px]` action chips and section labels.

#### /admin/reports  (P1)
- [2] two `<table>` at `reports-workspace.tsx:78,128` — first has overflow wrapper, second renders inside scroll-x.
- [4] `grid grid-cols-2 md:grid-cols-4 gap-3` — fine.

#### /admin/messages  (P2)
- [11] `text-[10px]` timestamps + unread badges.

#### /admin/live  (clean)
#### /admin/reservations  (clean)
#### /admin/tables  (clean)

#### /admin/riders  (P1)
- [2] table at `dedicated-riders-client.tsx:270`.

#### /admin/safety  (P1)
- [2] two tables in `rider-safety-client.tsx` (199, 247).
- [1] `max-w-[260px]`, `max-w-[320px]` truncate cells — cells fit within mobile width OK.

#### /admin/orders/[id]  (P2)
- [11] tiny tag badges.

### PLATFORM

#### platform/layout.tsx  (P1 — systemic)
- [3] **`grid grid-cols-[240px_1fr]` persistent sidebar** with 32 nav items. Same defect as admin layout but worse — super-admin sidebar is taller than the viewport on phones.

#### /platform (dashboard)  (P1)
- [4] `grid grid-cols-3 text-xs` Min/Avg/Peak strip at `page.tsx:241` — fits at 360px but tight.
- [9] `Sparkline width={800} height={160}` at line 239 — uses `className="w-full h-full"` so SVG scales. OK.
- [11] tiny labels throughout SmallStat / leaderboard rows.

#### /platform/analytics  (P1)
- [2] `<table>` at `page.tsx:79` — has overflow.
- [9] `YAxis width={100}` in `charts.tsx:47` — eats horizontal space on small screens.

#### /platform/restaurants  (P1)
- [1] `min-w-[240px]`, `min-w-[160px]/[180px]` filter selects — wrap but tight on phone.
- [4] `grid grid-cols-3 gap-2` mini-stats on card at line 238, `grid grid-cols-3 divide-x` at line 509 (no `sm:` qualifier).
- [5] DetailDrawer `width="680px"` — widest non-audit drawer.
- [11] `text-[10px]` parent badges.

#### /platform/restaurants/new  (P1)
- [4] step grids in `wizard-client.tsx` (similar to admin/branches/new).

#### /platform/brands  (P1)
- [1] `min-w-[240px]` search.
- [11] tiny status badges.

#### /platform/brands/[id]  (P1)
- [1] `min-w-[240px]` on a flex child.
- [11] tiny brand status + child status badges.

#### /platform/discovery-cms  (P2)
- [10] sticky toolbar `sticky top-0 z-10 bg-background/95` — only z-10 may conflict with admin demo banner. Low concern.
- [11] tiny badges.

#### /platform/signup-bonus  (P1)
- [2] table at `signup-bonus-client.tsx:317`.
- [11] tiny "Revoked"/"Warning" badges.

#### /platform/orders  (P1)
- [2] 9-column table at `explorer.tsx:110` — overflow-x-auto, but no card fallback. The widest single table.
- [1] `min-w-[240px]` search, `min-w-[180px]` select; `max-w-[180px]/[140px]` truncate cells.
- [11] `text-[10px]` provider-ref + payment-method badges.

#### /platform/live  (clean)
#### /platform/live-ops  (P1)
- [5] DetailDrawer `width="640px"`.
- [1] `max-w-[240px]` truncate; `min-w-[124px]` side panel.
- [11] sev badges.

#### /platform/feedback  (P1)
- [2] two tables (`feedback-client.tsx:114,180`).
- [1] `max-w-[240px]` truncate.
- [11] tiny lowOverallCount badges.

#### /platform/riders  (P1)
- [5] DetailDrawer `width="640px"`.
- [4] `grid grid-cols-4 gap-2 text-[11px]` at `explorer.tsx:108` (no responsive qualifier), `grid grid-cols-4 divide-x` at line 203.
- [1] `min-w-[240px]` search, `min-w-[260px]` row container.
- [11] online/unapproved badges.

#### /platform/kyc  (P1)
- [2] 6-col table in `kyc-queue-client.tsx:270`.
- [5] DetailDrawer `width="720px"` — second widest.
- [1] `max-w-[1400px]` page container is fine, but `min-w-[240px]` search.
- [11] tiny submitted-at timestamps + status pills.

#### /platform/payouts  (P1)
- [2] table at `page.tsx:47`.
- [4] `grid grid-cols-3 gap-3` for time pickers at `editor.tsx:191,199` — 3 inputs (hour/min/bonus) don't stack on phone.
- [10] `lg:sticky lg:top-6` preview pane — desktop only, OK.
- [11] tiny hint labels.

#### /platform/cod  (P1)
- [2] table at `cod-client.tsx:155`.
- [5] DetailDrawer `width="620px"`.
- [1] `min-w-[200px]`, `w-[160px]` date inputs, `max-w-[160px]` truncate rider name.
- [11] sort indicator + status badges `text-[10px]`.

#### /platform/users  (P1)
- [2] table at `explorer.tsx`.
- [5] DetailDrawer `width="640px"`.
- [4] `grid grid-cols-3 divide-x` at line 214.
- [1] `min-w-[240px]` search.

#### /platform/support  (P1)
- [2] table at `support-client.tsx:115`.
- [5] DetailDrawer at line 145 (default 560px).
- [1] `min-w-[200px]` filter.
- [11] tiny dt-labels.

#### /platform/qr  (P1)
- [2] table at `page.tsx:138`.
- [8] **`Button h-6 px-2 text-[10px]`** at line 162 — explicit small touch target.
- [11] tiny labels.
- [9] image `width={64} height={64}` for QR thumbnail — OK.

#### /platform/settlements  (P1)
- [2] two tables (`page.tsx:72,96`) — second uses `whitespace-nowrap` making horizontal scroll mandatory.
- [1] `w-[240px]` select, `w-[150px]` date inputs in `controls.tsx`.

#### /platform/reports  (clean — sectional page)

#### /platform/security  (P1)
- [2] table at `page.tsx:61`.
- [1] `max-w-[200px]` panels.
- [9] image `width={240} height={240}` TOTP QR — intentional.

#### /platform/audit-log  (P1)
- [2] table at `audit-client.tsx:178`.
- [5] DetailDrawer `width="900px"` — **widest drawer in the app** for the before/after JSON diff. Won't fit on tablets <1024px.
- [1] `min-w-[240px]` search; `max-w-[1400px]` outer container; `max-w-[180px]` truncate.
- [11] timestamp & actor-id `text-[10px]`.

#### /platform/system-health  (P1)
- [2] table at `page.tsx:174`.
- [1] `max-w-[280px]` truncate destructive text.

#### /platform/observability  (P1)
- [2] table at `observability-client.tsx:558`.
- [1] `min-w-[200px]`, `min-w-[220px]` filter wrappers; `max-w-[160px]/[360px]` truncate.
- [11] level + status badges `text-[10px]`.

#### /platform/messages  (P2)
- [11] timestamp + unread chip `text-[10px]`.

### Rider operations (platform sub-section — all P1, same shell defects)

#### /platform/rider-payouts  (P1)
- [2] table at `rider-payouts-client.tsx:79`.
- [1] `max-w-[160px]` truncate.
- [11] status badges.

#### /platform/rider-incentives  (P1)
- [4] `grid grid-cols-3 gap-3` at line 240 (no `sm:`).
- [11] period badges.

#### /platform/surge-zones  (P2)
- [11] multiplier badges `text-[10px]`.

#### /platform/rider-tiers  (P1)
- [2] table at `rider-tiers-client.tsx:107`.
- [1] `max-w-[180px]` truncate.
- [11] tier badges + sort indicator.

#### /platform/rider-referrals  (P1)
- [2] table at `rider-referrals-client.tsx:116`.
- [1] `max-w-[160px]/[150px]` truncate.
- [11] meta badges.

#### /platform/rider-sos  (P0 — emergency UI)
- [2] table at `rider-sos-client.tsx:143`.
- [5] DetailDrawer `width="560px"`.
- [11] destructive + variant badges `text-[10px]`.
- This is the SOS console for live emergencies — must work on a phone if a duty officer is away from a desk. Marking P0.

#### /platform/rider-incidents  (P1)
- [2] table at `rider-incidents-client.tsx:112`.
- [5] DetailDrawer `width="580px"`.
- [1] `max-w-[280px]` truncate.
- [11] type badges.

#### /platform/rider-shifts  (P1)
- [2] table at `rider-shifts-client.tsx:133`.
- [1] `w-[160px]` date inputs.
- [11] status badge.

#### /platform/rider-support  (P1)
- [2] table at `rider-support-client.tsx:87`.
- [5] DetailDrawer `width="640px"`.
- [1] `max-w-[260px]` truncate subject.
- [11] tag + timestamp.

#### /platform/training-modules  (P1)
- [2] table at `training-modules-client.tsx`.
- [5] DetailDrawer `width="620px"`.
- [1] `max-w-[260px]` truncate; `min-w-[180px]` filter.

#### /platform/training-modules/[id]/preview  (P2)
- [10] sticky header `sticky top-0 z-40` — z-40 may collide with mobile bottom-nav (z-40 too), but this route is platform so bottom-nav already hides.

### KITCHEN

#### /kitchen  (clean)
- `md:grid-cols-3` columns, `flex-wrap` toolbar, mobile column-scroll wrapper `-mx-4 md:mx-0 overflow-x-auto`. Cleanly responsive — no changes needed.

### ROOT

#### /qr/[code]  (clean)
#### /demo-gate  (clean)

---

## Top 3 most common defects (frequency-ranked)

1. **[3] Unresponsive sidebar shells (admin + platform layouts)** — applies systemically to ~75 routes. **Build AdminShell first.**
2. **[2] Tables without mobile-card fallback** — 28 tables across platform/admin. Most have `overflow-x-auto` so they technically scroll, but horizontal scroll on a 9-column orders table is unusable on a phone. **Build ResponsiveTable second.**
3. **[4] `grid grid-cols-N` without responsive qualifier on form rows and KPI strips** — 22+ instances, mostly forms (`admin/branches/new`, `platform/payouts/editor`, `admin/offers/offer-editor`, `admin/storefront/storefront-editor`) and stat strips inside cards. **Build FormGrid + KpiStrip third.** Co-occurs with defect [6] (forms not stacking).

Honourable mentions: defect [11] (`text-[10px]` on body copy) shows up ~80 times but mostly on intentional badges and uppercase tracking-wider chips — most are not actually body copy and can stay. Defect [5] (drawer widths) is mitigated by the existing `width:100%, maxWidth` pattern but consumers passing 680-900px should be normalised to a tokenised set (`sm/md/lg/xl`). Defect [1] (`min-w-[200..260px]` on filter inputs) is the highest-frequency `[1]` issue and should be addressed inside the FilterBar primitive — drop `min-w-*` under `sm:`.
