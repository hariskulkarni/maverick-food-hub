import { test, expect, devices, type Page } from '@playwright/test';
import { signInAsCustomer } from './fixtures/auth';

/**
 * Mobile bottom-nav + sticky-cart-bar contract spec.
 *
 * Locks the visibility, active-tab indicator, cart-badge sync, sticky-cart-bar
 * placement, layout reservation and bottom-sheet dialog rendering for the
 * mobile-first responsive redesign.
 *
 * Most tests run anonymously — the bottom nav doesn't gate on auth. The
 * "addresses bottom-sheet dialog" test signs in as the seeded customer so we
 * can poke a real `<DialogContent>` (the address picker on /profile/addresses
 * is the cleanest canonical instance in the customer area).
 *
 * Seed dependency: the slug `saffron-smoke` from `prisma/seed.ts`. We chose
 * this over `italia-pizza` because the latter only exists in the
 * `seed-brand-mavericks.ts` overlay (run via `npm run db:seed:cuisines`).
 * Swap the constant below if you re-seed.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const RESTAURANT_SLUG = 'saffron-smoke';

/** Locator helper — the bottom nav element. */
const navLocator = (page: Page) =>
  page.getByRole('navigation', { name: 'Primary' });

/** Locator helper — the sticky cart bar (matched by its aria-label prefix). */
const cartBarLocator = (page: Page) =>
  page.getByRole('link', { name: /^Open cart/ });

// ─────────────────────────────────────────────────────────────────────────────
// A) VISIBILITY
// ─────────────────────────────────────────────────────────────────────────────
test.describe('mobile (390x844) — visibility', () => {
  test.use({ viewport: PHONE });

  const customerRoutes = [
    '/',
    '/restaurants',
    `/r/${RESTAURANT_SLUG}`,
    '/cart',
    '/orders',
    '/profile'
  ];

  for (const path of customerRoutes) {
    test(`bottom nav is visible on ${path}`, async ({ page }) => {
      // /orders + /profile redirect to /login when anonymous — sign in so the
      // page renders the customer surface (and thus the bottom nav).
      if (path === '/orders' || path === '/profile') {
        await signInAsCustomer(page);
      }
      await page.goto(path);
      await expect(navLocator(page)).toBeVisible();
    });
  }

  const hiddenRoutes = [
    '/login',
    '/admin',
    '/platform',
    '/rider',
    '/kitchen',
    '/checkout'
  ];

  for (const path of hiddenRoutes) {
    test(`bottom nav is hidden on ${path}`, async ({ page }) => {
      // We don't care whether we hit a 403, redirect to /login, or render the
      // actual surface — the nav must not appear on any of these prefixes.
      // `goto` may throw on a redirect target mismatch in some Next.js
      // configs; swallow so the visibility assertion is what fails (or passes).
      await page.goto(path).catch(() => {});
      await expect(navLocator(page)).toHaveCount(0);
    });
  }
});

test.describe('desktop (1280x800) — visibility', () => {
  test.use({ viewport: DESKTOP });

  test('bottom nav is hidden on every customer route', async ({ page }) => {
    const routes = [
      '/',
      '/restaurants',
      `/r/${RESTAURANT_SLUG}`,
      '/cart'
    ];
    for (const path of routes) {
      await page.goto(path);
      // The nav element is `md:hidden` so it stays in the DOM but is not
      // visible at md+. Assert `toBeHidden()` rather than `toHaveCount(0)`.
      await expect(navLocator(page), `bottom nav should be hidden on ${path}`).toBeHidden();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B) ACTIVE-TAB INDICATOR
// ─────────────────────────────────────────────────────────────────────────────
test.describe('mobile (390x844) — active tab', () => {
  test.use({ viewport: PHONE });

  test('Home tab is active on `/`, pill is translated to index 0', async ({ page }) => {
    await page.goto('/');
    const home = page.getByRole('link', { name: /^home/i });
    await expect(home).toHaveAttribute('aria-current', 'page');

    // The sliding pill sits inside the nav, has aria-hidden, and its inline
    // `transform` reads `translateX(<idx>*100%)`. activeIndex === 0 → 0%.
    const pillTransform = await navLocator(page)
      .locator('div[aria-hidden]')
      .first()
      .evaluate((el) => (el as HTMLElement).style.transform);
    // Home is index 0 → translateX(0%) (or just translateX(0)).
    expect(pillTransform).toMatch(/translateX\(0%?\)/);
  });

  test('clicking Dine In navigates to /dine-in and flips aria-current', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^dine in/i }).click();
    await page.waitForURL(/\/dine-in$/);
    await expect(page.getByRole('link', { name: /^dine in/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
    // Pill at index 1 → translateX(100%).
    const pillTransform = await navLocator(page)
      .locator('div[aria-hidden]')
      .first()
      .evaluate((el) => (el as HTMLElement).style.transform);
    expect(pillTransform).toMatch(/translateX\(100%\)/);
  });

  test('Dine In stays active on /dine-in', async ({ page }) => {
    await page.goto('/dine-in');
    await expect(page.getByRole('link', { name: /^dine in/i })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C) CART BADGE SYNC + D) STICKY CART BAR
// ─────────────────────────────────────────────────────────────────────────────
test.describe('mobile (390x844) — cart badge & sticky bar', () => {
  test.use({ viewport: PHONE });

  test('empty cart: no badge on Cart tab, no sticky bar', async ({ page }) => {
    await page.goto('/');
    const cartTab = page.getByRole('link', { name: /^cart$/i });
    await expect(cartTab).toBeVisible();
    // No nested badge span — the badge child only renders when count > 0.
    await expect(cartTab.locator('span >> text=/^\\d/')).toHaveCount(0);
    // Sticky cart bar absent.
    await expect(cartBarLocator(page)).toHaveCount(0);
  });

  test('adding an item: cart tab shows badge "1", aria-label updates, sticky bar points at /cart', async ({ page }) => {
    await page.goto(`/r/${RESTAURANT_SLUG}`);
    // Click the first "Add" button on a menu card.
    const addButtons = page.getByRole('button', { name: /^add$/i });
    await addButtons.first().waitFor({ state: 'visible' });
    await addButtons.first().click();

    // The Cart tab now has a count of 1 in its aria-label and a visible badge.
    const cartTab = page.getByRole('link', { name: /^cart, 1 item in cart$/i });
    await expect(cartTab).toBeVisible();
    await expect(cartTab.getByText('1', { exact: true })).toBeVisible();

    // Sticky cart bar appears and links to /cart.
    const bar = cartBarLocator(page);
    await expect(bar).toBeVisible();
    const href = await bar.getAttribute('href');
    expect(href).toBe('/cart');
  });

  test('count >= 10: badge clamps to "9+"', async ({ page }) => {
    await page.goto(`/r/${RESTAURANT_SLUG}`);
    const addButtons = page.getByRole('button', { name: /^add$/i });
    await addButtons.first().waitFor({ state: 'visible' });
    await addButtons.first().click();

    // After the first Add the card flips into the stepper view. The "+" hit
    // area carries `aria-label="Increase quantity"`. Click 9 more times for a
    // total of 10.
    const plus = page.getByRole('button', { name: /increase quantity/i }).first();
    await plus.waitFor({ state: 'visible' });
    for (let i = 0; i < 9; i++) {
      await plus.click();
    }

    // Cart tab badge clamps to "9+".
    const cartTab = page.getByRole('link', { name: /^cart, 10 items in cart$/i });
    await expect(cartTab).toBeVisible();
    await expect(cartTab.getByText('9+', { exact: true })).toBeVisible();
  });

  test('sticky cart bar is hidden on /cart', async ({ page }) => {
    // Seed an item first on a restaurant page, then navigate to /cart.
    await page.goto(`/r/${RESTAURANT_SLUG}`);
    const addButtons = page.getByRole('button', { name: /^add$/i });
    await addButtons.first().waitFor({ state: 'visible' });
    await addButtons.first().click();
    // Sanity: bar visible here.
    await expect(cartBarLocator(page)).toBeVisible();

    await page.goto('/cart');
    // Bar should self-hide on /cart (the component returns null for
    // /cart and /checkout prefixes).
    await expect(cartBarLocator(page)).toHaveCount(0);
  });

  test('sticky cart bar visible on /r/<slug> when cart has items', async ({ page }) => {
    await page.goto(`/r/${RESTAURANT_SLUG}`);
    const addButtons = page.getByRole('button', { name: /^add$/i });
    await addButtons.first().waitFor({ state: 'visible' });
    await addButtons.first().click();

    const bar = cartBarLocator(page);
    await expect(bar).toBeVisible();
    // The bar's container is fixed with `bottom: calc(56px + ...)` so its
    // bounding box should sit in the lower portion of the viewport, above
    // the 56px nav. Loose bound: top > 600.
    const box = await bar.boundingBox();
    expect(box, 'sticky cart bar bounding box').not.toBeNull();
    expect(box!.y, 'sticky cart bar sits in the lower portion of the viewport').toBeGreaterThan(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E) LAYOUT RESERVATION
// ─────────────────────────────────────────────────────────────────────────────
test.describe('layout reservation (<main> padding-bottom)', () => {
  test('mobile (390x844): main reserves 88px of bottom padding; footer hidden, nav visible', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: PHONE });
    const page = await ctx.newPage();
    await page.goto('/');

    const mainPadding = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return null;
      return getComputedStyle(main).paddingBottom;
    });
    expect(mainPadding).toBe('88px');

    // Footer is `hidden md:block` — it stays in the DOM at this viewport but
    // is not displayed.
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeHidden();

    // Bottom nav is visible.
    await expect(navLocator(page)).toBeVisible();
    await ctx.close();
  });

  test('desktop (1280x800): main has zero bottom padding', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: DESKTOP });
    const page = await ctx.newPage();
    await page.goto('/');
    const mainPadding = await page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return null;
      return getComputedStyle(main).paddingBottom;
    });
    expect(mainPadding).toBe('0px');
    await ctx.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F) BOTTOM-SHEET DIALOG
// ─────────────────────────────────────────────────────────────────────────────
test.describe('mobile (390x844) — bottom-sheet dialog', () => {
  test.use({ viewport: PHONE });

  test('address picker dialog opens anchored to the bottom (data-state="open", bottom: 0)', async ({ page }) => {
    // The cleanest canonical Dialog in the (customer) tree is the address
    // picker on /profile/addresses. It requires a signed-in customer.
    await signInAsCustomer(page);
    await page.goto('/profile/addresses');

    // Open the dialog via the "Add address" / "Add your first address" button.
    // First-time customers see the empty-state CTA; otherwise the header one.
    const trigger = page
      .getByRole('button', { name: /^add( your first)? address$/i })
      .first();
    await trigger.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-state', 'open');

    // Bottom-sheet styling: at mobile viewport the dialog is anchored to the
    // bottom of the viewport (computed `bottom: 0px`). At md+ the same
    // element would sit centered with `bottom: auto`.
    const computedBottom = await dialog.evaluate(
      (el) => getComputedStyle(el as HTMLElement).bottom
    );
    expect(computedBottom).toBe('0px');
  });
});
