# Flavrly responsive playbook

Every page in this app must be mobile-first. The audit in `RESPONSIVE_AUDIT.md`
catalogues the 116 surfaces and the ~210 issues that triggered this rewrite.
This document is the **single source of truth** for *how* we make things
responsive going forward, so contributors don't have to re-derive patterns
from scratch.

If you're touching a page, follow this playbook before adding new wrappers,
new breakpoints, or new media queries. If the primitives below don't cover
your case, extend them here in one place — don't fork the pattern into the
page.

---

## Principles

1. **Phone is the canvas.** Author for ≤ 360px first, then `sm:` (640), `md:`
   (768), `lg:` (1024) progressively enhance. Avoid `desktop-first` patterns
   like `grid-cols-4 md:grid-cols-2`.
2. **No fixed widths < 768px.** Anything with `width="900px"`, `min-w-[680px]`,
   `w-[480px]` on a phone breaks the page. Use `w-full` + a `md:max-w-…`
   ceiling.
3. **Tap target ≥ 44px.** Touch elements (buttons, nav links, row links)
   need at least `min-h-[44px]` and visible spacing.
4. **No horizontal scroll on phones except table-like data.** A horizontal
   page scrollbar at 360px is always a bug. If data genuinely doesn't fit
   (wide reports), wrap in `<div className="overflow-x-auto">` so the *table*
   scrolls, not the page.
5. **Sticky bottom bars eat space.** The customer shell reserves
   `pb-[env(safe-area-inset-bottom)+72px]`; if you add another sticky bar,
   add to that reservation.
6. **Use the primitives.** They exist precisely so the next page doesn't
   re-invent the layout.

---

## Primitives

All primitives live under `apps/web/src/components/{shell,responsive}`. Import
them by name; never re-implement.

### `AdminShell` — sidebar shell for admin + platform

`apps/web/src/components/shell/admin-shell.tsx`

```tsx
import { AdminShell, type NavGroup } from '@/components/shell/admin-shell';

const NAV_GROUPS: NavGroup[] = [
  { items: [{ href: '/admin', icon: LayoutDashboard, label: 'Dashboard' }, …] },
  { title: 'Storefront', items: [{ href: '/admin/storefront', icon: Paintbrush, label: 'Storefront CMS' }] },
];

export default function Layout({ children }) {
  return (
    <AdminShell
      title={<Link href="/admin">Flavrly</Link>}
      subtitle="Restaurant admin"
      navGroups={NAV_GROUPS}
      topBanner={<DemoBanner />}
      footer={<LogoutButton />}
    >
      {children}
    </AdminShell>
  );
}
```

Behaviour
* Phones: hamburger top bar + slide-in drawer (`MobileNavBar`). Body
  scroll-locks while open, closes on ESC, scrim tap, and route change.
* md+: classic `grid-cols-[240px_1fr]` with sticky left sidebar.

Both `/admin/layout.tsx` and `/platform/layout.tsx` use this shell. Do not
re-create the sidebar by hand.

### `ResponsiveTable<K>` — list view with mobile card fallback

`apps/web/src/components/responsive/responsive-table.tsx`

```tsx
<ResponsiveTable
  columns={[
    { key: 'name',   header: 'Name',   primary: true },
    { key: 'status', header: 'Status' },
    { key: 'total',  header: 'Total',  className: 'text-right tabular-nums' },
  ]}
  rows={orders.map((o) => ({
    id: o.id,
    href: `/admin/orders/${o.id}`,
    cells: { name: o.code, status: <Badge>{o.status}</Badge>, total: money(o.total) },
  }))}
  emptyState="No orders in this filter."
/>
```

Behaviour
* md+: real `<table>` inside an `overflow-x-auto` rounded card.
* Phones: vertically stacked cards. Columns marked `primary: true` are
  emphasised at the top; the rest render as a `dl` grid of header→value.
* Each row may be a `href` link or `onClick` button — clicking the row
  navigates / fires. Rows are at least 44px tall in both modes.
* `hideOnMobile` / `hideOnDesktop` flags let you drop noisy secondary
  columns from phones (e.g. IDs, raw timestamps).

Adopt this for: orders, restaurants, riders, users, payouts, settlements,
audit log, COD reconciliation, KYC review, SOS alerts, training modules,
batch invitations, feedback list, reports tables.

### `ResponsiveDrawer` — detail drawer (bottom sheet on phones)

`apps/web/src/components/responsive/responsive-drawer.tsx`

```tsx
<ResponsiveDrawer
  open={open}
  onOpenChange={setOpen}
  title={order.code}
  subtitle={order.customerName}
  badge={<Badge>{order.status}</Badge>}
  desktopWidth="min(900px, 90vw)"
  footer={<Button onClick={refund}>Refund</Button>}
>
  …
</ResponsiveDrawer>
```

Behaviour
* Phones: full-width bottom sheet, 92vh max, slides up from the bottom.
  Grab handle, X button, scrim tap, ESC all dismiss.
* md+: right-side panel, `desktopWidth` wide (default 680px). Pass
  `min(900px, 90vw)` for data-heavy drawers like audit-log JSON viewer.
* Body scroll-lock while open.

Adopt this everywhere a `<Dialog>` is currently used with a hard-coded width.
Search the codebase for `width="\d+px"` or `min-w-\[\d+px\]` on `DialogContent`
to find candidates.

### `FormGrid` / `StatGrid` — responsive form & KPI grids

`apps/web/src/components/responsive/form-grid.tsx`

```tsx
<FormGrid cols={3} gap="md">
  <Field label="Name">…</Field>
  <Field label="Phone">…</Field>
  <Field label="Email">…</Field>
</FormGrid>

<StatGrid cols={4}>
  <StatCard label="Orders" value={kpi.orders} />
  …
</StatGrid>
```

Behaviour
* `FormGrid cols={2}` → `grid-cols-1 sm:grid-cols-2`
* `FormGrid cols={3}` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
* `FormGrid cols={4}` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`
* `StatGrid` defaults to 2-col on phones (KPI cards read fine 2-up at 360px
  because the labels are short).

Adopt instead of bare `grid-cols-N` on forms and dashboards.

### `MobileFilterBar` — list toolbar that collapses to a bottom sheet

`apps/web/src/components/responsive/mobile-filter-bar.tsx`

```tsx
<MobileFilterBar
  search={<SearchInput value={q} onChange={setQ} />}
  activeCount={[status, range, sort].filter(Boolean).length}
  rightSlot={<Button>+ New</Button>}
>
  <StatusPills value={status} onChange={setStatus} />
  <DateRangePicker value={range} onChange={setRange} />
  <SortSelect value={sort} onChange={setSort} />
</MobileFilterBar>
```

Behaviour
* md+: inline horizontal toolbar that wraps.
* Phones: always-visible search input + a "Filters" button. Tapping opens a
  bottom sheet with the same controls vertically. ESC + scrim dismiss; an
  active-filter count badges the button.

Use for: orders list, payouts, KYC review, audit log, settlements, brands,
QR codes, all "list page with toolbar" surfaces.

---

## The standard refactor recipe

When porting a list/detail/form page to be mobile-first, follow these steps
in order. Don't skip steps; the order eliminates regressions.

1. **Replace the toolbar** with `<MobileFilterBar>`. Hoist filter state to
   the page; the bar is layout-only.
2. **Replace the list** with `<ResponsiveTable>`. Mark the *defining* column
   `primary: true` (usually name/code). Hide IDs/timestamps on phones with
   `hideOnMobile`.
3. **Replace any detail dialog** with `<ResponsiveDrawer>`. Drop hard-coded
   widths. If the data is wide (JSON, transcripts), pass
   `desktopWidth="min(900px, 90vw)"`.
4. **Replace form rows** with `<FormGrid cols={2|3|4}>`. Wrap KPI rows in
   `<StatGrid>`.
5. **Audit the page wrapper.** Outer padding should be `p-4 md:p-6 lg:p-8`,
   not a fixed value. Page max-width via `max-w-7xl mx-auto`, not pixel
   widths.
6. **Audit any leftover `min-w-[…px]` and `w-[…px]`** in this page only —
   they're almost always the cause of horizontal scroll on phones.

After step 6, run the page through DevTools at 360px wide and confirm: no
horizontal scrollbar on the page, every tap target ≥ 44px, every column you
care about is reachable.

---

## Forbidden patterns

These patterns are the root cause of the bugs we're fixing. Don't introduce
them on new work; remove them when you find them.

| Anti-pattern | Why it breaks | Replace with |
| --- | --- | --- |
| `grid-cols-3` / `grid-cols-4` on forms | Inputs are unusable at 360px | `<FormGrid cols={3}>` |
| `<DialogContent style={{ width: 900 }}>` | Doesn't fit; clips off-screen | `<ResponsiveDrawer desktopWidth="min(900px, 90vw)">` |
| `<table>` with fixed columns | Page-level horizontal scroll on phones | `<ResponsiveTable>` |
| `min-w-[680px]` on a sidebar | Hidden under the screen edge | `<AdminShell>` (already responsive) |
| `<div className="flex gap-4">` of 6 filter inputs | Overflows / wraps unpredictably | `<MobileFilterBar>` |
| `h-9` buttons | Below the 44px touch target | `min-h-[44px]` or `h-11` |
| `max-h-[90vh]` modals without `overflow-y-auto` | Content clipped, no scroll | always include `overflow-y-auto` on the body |
| `position: fixed; bottom: 0;` without bottom padding | Covers content at end of page | add page padding to match the bar |

---

## Verification

Before opening a PR that claims a page is responsive, verify:

* Chrome DevTools, "Responsive" device, **360 × 640** — no horizontal page
  scroll, every interactive element tappable.
* Chrome DevTools, **768 × 1024** — the tablet form factor uses the right
  layout (usually 2-col grids, sidebar still hidden on `/admin` style
  pages, table view starts appearing).
* Chrome DevTools, **1280 × 800** — desktop layout matches the design.

Playwright covers the headline pages at these viewports — extend the spec
when you add a new top-level page.

---

## What's already done (Phase 1)

* `AdminShell` + `MobileNavBar` — used by `/admin` and `/platform` layouts.
  All 35+ admin pages and all 36+ platform pages now have a hamburger drawer
  on phones.
* `ResponsiveTable` — primitive available; adoption rolls in Phases 3–4.
* `ResponsiveDrawer` — primitive available; replaces the audit-log,
  rider-detail, restaurant-detail, user-detail, order-detail drawers.
* `FormGrid` / `StatGrid` — primitives available; replace ad-hoc grids in
  settings, wizard, and dashboard surfaces.
* `MobileFilterBar` — primitive available; replaces toolbars on list pages.
* `globals.css` — added `animate-slide-in-l` (drawer) and `animate-slide-up`
  (bottom sheet) keyframes.

The remaining phases (2–5) adopt the primitives in waves; Phase 6 covers
Playwright at 360/768/1280; Phase 7 adds ESLint guardrails to keep the
forbidden patterns out.
