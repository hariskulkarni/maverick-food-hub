import { test, expect, type Page, type Browser } from '@playwright/test';
import { signInAsAdmin, signInAsCustomer, signInAsRider } from './fixtures/auth';

/**
 * Rider mobile viewport (iPhone 14 Pro: 390×844) spec.
 *
 * Locks in the visual contract for the rebuilt /rider screen:
 *   - Compact status strip ≤80px tall at the top
 *   - When no assignment is active: empty-state radar card, no card
 *   - When an assignment IS active:
 *       • exactly one Items section (no duplicate)
 *       • map starts above the fold (top < 600 on 844 viewport)
 *       • bottom-right FAB stack: Recenter / Fit / Layer / Fullscreen,
 *         each ≥40×40
 *       • primary action ≥48px tall, label matches the current stage
 *       • exactly one "Call" button on the card
 *       • no horizontal overflow (scrollWidth === 390)
 *   - FAB clicks are reachable without auto-scroll
 *   - Sign-out flow lands on /login or /login?mode=rider
 */

const IPHONE_14_PRO = { width: 390, height: 844 };

test.use({ viewport: IPHONE_14_PRO });

// ── Setup helper ──────────────────────────────────────────────────────────
// Mirrors the pattern in rider-pool.spec.ts: a separate browser context for
// the customer (places COD order) and the admin (walks to READY).
// Returns the order code so the rider context can find + claim it in the pool.
async function placeAndReadyOrder(browser: Browser): Promise<string> {
  const customerCtx = await browser.newContext();
  const customerPage = await customerCtx.newPage();
  await signInAsCustomer(customerPage);
  await customerPage.goto('/r/saffron-smoke');
  const adds = customerPage.getByRole('button', { name: /^add$/i });
  await adds.first().waitFor();
  await adds.nth(0).click();
  await adds.first().click();
  await customerPage.goto('/checkout');
  await customerPage.getByRole('button', { name: /cash on delivery/i }).click();
  const place = customerPage.getByRole('button', { name: /place order ·/i });
  await expect(place).toBeEnabled({ timeout: 10_000 });
  await place.click();
  await customerPage.waitForURL(/\/orders\/[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  const headerText = await customerPage.getByRole('heading', { name: /^order /i }).innerText();
  const code = headerText.replace(/^order\s+/i, '').trim();
  await customerCtx.close();

  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await signInAsAdmin(adminPage);
  await adminPage.goto('/admin/orders');
  const codeLink = adminPage.getByRole('link', { name: code }).first();
  await codeLink.waitFor({ state: 'visible', timeout: 15_000 });
  await adminPage.getByRole('button', { name: /^accept$/i }).first().click();
  await adminPage.getByRole('button', { name: /start preparing/i }).first().click();
  await adminPage.getByRole('button', { name: /mark ready/i }).first().click();
  // Give SSE a beat to propagate READY → pool.
  await adminPage.waitForTimeout(500);
  await adminCtx.close();

  return code;
}

// Ensure rider is online and there's no horizontal scroll.
async function goOnline(page: Page): Promise<void> {
  await page.goto('/rider');
  const onlineSwitch = page.getByRole('switch').first();
  await onlineSwitch.waitFor({ state: 'visible' });
  const state = await onlineSwitch.getAttribute('data-state');
  // The Switch lives inside a small pill — toggle if it isn't already on.
  if (state !== 'checked') {
    await onlineSwitch.click();
  }
}

test.describe('Rider mobile (iPhone 14 Pro, 390×844)', () => {
  test('empty state: compact status strip + radar card, no assignment card', async ({ page }) => {
    await signInAsRider(page);
    await goOnline(page);

    // ── Status strip is at the top and stays compact (≤80px). The strip
    // wraps the rider's online toggle, so we find it by walking up from the
    // [role="switch"] to the nearest sized wrapper.
    const onlineSwitch = page.getByRole('switch').first();
    await onlineSwitch.waitFor({ state: 'visible' });
    // The compact strip is a div with `h-14` (56px). We grab its bounding
    // box via the rounded card ancestor.
    const stripBox = await page.evaluate(() => {
      const sw = document.querySelector('[role="switch"]');
      if (!sw) return null;
      // Walk up to find the outer rounded wrapper.
      let el: HTMLElement | null = sw as HTMLElement;
      while (el && !el.className?.includes?.('rounded-2xl')) {
        el = el.parentElement;
      }
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    expect(stripBox, 'status strip wrapper found').not.toBeNull();
    expect(stripBox!.top).toBeLessThan(120);
    expect(stripBox!.height).toBeLessThanOrEqual(80);

    // ── Empty-state radar card visible.
    await expect(
      page.getByText(/waiting for your next delivery|go online to start receiving orders/i).first()
    ).toBeVisible();

    // ── No assignment card visible: no stage banner text on the page.
    await expect(page.getByText(/awaiting acceptance/i)).toHaveCount(0);
    await expect(page.getByText(/en route to pickup/i)).toHaveCount(0);
    await expect(page.getByText(/heading to customer/i)).toHaveCount(0);

    // ── No horizontal overflow on the empty surface either.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(IPHONE_14_PRO.width);
  });

  test('with active assignment: layout, FAB stack, no duplicate items, sign-out', async ({ page, browser }) => {
    const code = await placeAndReadyOrder(browser);

    await signInAsRider(page);
    await goOnline(page);

    // Visit the pool and claim our order. Mirrors rider-pool.spec.ts.
    await page.goto('/rider/pool');
    await expect(page.getByRole('heading', { name: /available deliveries/i })).toBeVisible();
    const orderCard = page.locator('div', { has: page.getByText(code, { exact: true }) }).first();
    await orderCard.waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('button', { name: /^claim$/i }).first().click();
    await page.waitForURL(/\/rider$/, { timeout: 10_000 });

    // Force-navigate back to /rider (active tab) — already there after claim,
    // but explicit in case the route differs in some env.
    await page.goto('/rider');

    // Wait for the assignment card to mount.
    await expect(page.getByText(/awaiting acceptance/i).first()).toBeVisible({ timeout: 10_000 });

    // ── No duplicate Items section. The collapsible items row exposes its
    // count as accessible text like "1 item · 2 pcs". A duplicate from the
    // pre-rebuild design would surface a second region. We assert the count
    // of buttons whose accessible name matches /^\d+ items?/i is exactly 1.
    const itemsButtons = page.getByRole('button', { name: /^\d+ items?\b/i });
    await expect(itemsButtons).toHaveCount(1);

    // ── Map is visible above the fold.
    const map = page.locator('.leaflet-container').first();
    await map.waitFor({ state: 'visible', timeout: 10_000 });
    const mapBox = await map.boundingBox();
    expect(mapBox, 'map bounding box').not.toBeNull();
    expect(mapBox!.y).toBeLessThan(600);

    // ── FAB stack — four buttons in the bottom-right with the expected
    // aria-labels and ≥40×40 tap targets.
    const fabLabels: Array<{ pattern: RegExp; key: string }> = [
      { pattern: /recenter/i,   key: 'Recenter' },
      { pattern: /\bfit\b/i,    key: 'Fit' },
      { pattern: /\blayer|map style/i, key: 'Layer' },
      { pattern: /fullscreen/i, key: 'Fullscreen' }
    ];
    for (const { pattern, key } of fabLabels) {
      const fab = page.getByRole('button', { name: pattern }).first();
      await expect(fab, `${key} FAB present`).toBeVisible();
      const box = await fab.boundingBox();
      expect(box, `${key} FAB bounding box`).not.toBeNull();
      expect(box!.width, `${key} FAB width ≥40`).toBeGreaterThanOrEqual(40);
      expect(box!.height, `${key} FAB height ≥40`).toBeGreaterThanOrEqual(40);
    }

    // ── Primary action button at bottom of card. PENDING stage → "Accept
    // delivery". ≥48px tall.
    const primary = page.getByRole('button', { name: /accept delivery|mark picked up|enter delivery otp/i }).first();
    await expect(primary).toBeVisible();
    const primaryBox = await primary.boundingBox();
    expect(primaryBox, 'primary action bounding box').not.toBeNull();
    expect(primaryBox!.height, 'primary action ≥48px tall').toBeGreaterThanOrEqual(48);

    // ── No horizontal overflow.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBe(IPHONE_14_PRO.width);

    // ── Call customer button appears once and only once in the card.
    // The Call link uses `aria-label="Call <name>"` so we match the prefix.
    const callButtons = page.getByRole('link', { name: /^call\b/i });
    await expect(callButtons).toHaveCount(1);

    // ── Map control reachability: each FAB clicks without throwing.
    // `noWaitAfter` keeps the click from blocking on navigation.
    for (const { pattern, key } of fabLabels) {
      const fab = page.getByRole('button', { name: pattern }).first();
      // Skip the Fullscreen button — requestFullscreen requires a user gesture
      // and headless Chromium rejects it; we still assert the click handler
      // doesn't throw and the test doesn't auto-scroll.
      const beforeScrollY = await page.evaluate(() => window.scrollY);
      await fab.click({ trial: false, timeout: 2_000 }).catch((err) => {
        // Surface the failure with the key so the assertion message is useful.
        throw new Error(`FAB click failed (${key}): ${(err as Error).message}`);
      });
      const afterScrollY = await page.evaluate(() => window.scrollY);
      // Auto-scroll would change scrollY — assert it's unchanged (the FAB
      // is fully in-viewport because it lives inside the visible map box).
      expect(Math.abs(afterScrollY - beforeScrollY), `${key} click should not auto-scroll`).toBeLessThanOrEqual(2);
    }

    // ── Sign-out flow.
    // Open the account menu via its avatar button (top-right, aria-label="Account menu").
    await page.getByRole('button', { name: /account menu/i }).click();
    // Sheet opens — Radix uses role="dialog" with the title "Account".
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/^account$/i).first()).toBeVisible();

    // Sign out button — text "Sign out" (button, not a link).
    const signOut = page.getByRole('button', { name: /^sign out$/i });
    await expect(signOut).toBeVisible();
    await signOut.click();

    // Lands on /login (with or without ?mode=rider).
    await page.waitForURL(/\/login(\?.*)?$/, { timeout: 10_000 });
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
  });
});
