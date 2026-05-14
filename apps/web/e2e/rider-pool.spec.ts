import { test, expect, type Page } from '@playwright/test';
import { signInAsAdmin, signInAsCustomer, signInAsRider } from './fixtures/auth';

/**
 * Rider order-pool flow:
 *   1. (setup) customer places an order
 *   2. (setup) admin walks it through to READY so it lands in the pool
 *   3. rider toggles online, opens /rider/pool, claims the order
 *   4. on the assignment card: Accept → Picked up
 *   5. verify the assignment-card stage badge updates after each click
 */

async function placeAndReadyOrder(page: Page, browser: import('@playwright/test').Browser): Promise<string> {
  // Step 1: customer places a fresh COD order.
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

  // Step 2: admin walks it to READY.
  const adminCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  await signInAsAdmin(adminPage);
  await adminPage.goto('/admin/orders');
  const codeLink = adminPage.getByRole('link', { name: code }).first();
  await codeLink.waitFor({ state: 'visible', timeout: 15_000 });
  // Walk it forward: Accept → Start preparing → Mark ready.
  // Buttons all live on the same card. We can just click them in sequence
  // and let the SSE re-render swap them in.
  await adminPage.getByRole('button', { name: /^accept$/i }).first().click();
  await adminPage.getByRole('button', { name: /start preparing/i }).first().click();
  await adminPage.getByRole('button', { name: /mark ready/i }).first().click();
  // Wait for the pool to actually have the order — the API does a server-side
  // join on status=READY. A small wait gives the transition time to flush.
  await adminPage.waitForTimeout(500);
  await adminCtx.close();

  return code;
}

test.describe('Rider pool: toggle online → claim → accept → pick up', () => {
  test('claims a READY order and walks it through pickup', async ({ page, browser }) => {
    const code = await placeAndReadyOrder(page, browser);

    await signInAsRider(page);

    // Toggle online on the rider home (`/rider`). The Switch is the only
    // switch on the page; `getByRole('switch')` is the most stable selector.
    await page.goto('/rider');
    const onlineSwitch = page.getByRole('switch').first();
    await onlineSwitch.waitFor({ state: 'visible' });
    // It might already be online from the seed — toggling it on twice is a
    // no-op, so we just make sure it ends up "on".
    const state = await onlineSwitch.getAttribute('data-state');
    if (state !== 'checked') await onlineSwitch.click();
    await expect(page.getByText(/you're online|sharing location/i).first()).toBeVisible();

    // Open the pool. The seeded rider is already online from the seed
    // (isOnline: true), but the API also keys off the rider being approved —
    // which the seed sets via approvedAt.
    await page.goto('/rider/pool');
    await expect(page.getByRole('heading', { name: /available deliveries/i })).toBeVisible();

    // Wait for our order to appear by code. The list refetches on SSE plus
    // on mount.
    const orderCard = page.locator('div', { has: page.getByText(code, { exact: true }) }).first();
    await orderCard.waitFor({ state: 'visible', timeout: 15_000 });

    // Claim it. Successful claim navigates to /rider.
    await page.getByRole('button', { name: /^claim$/i }).first().click();
    await page.waitForURL(/\/rider$/, { timeout: 10_000 });

    // ── Accept the assignment (PENDING → ACCEPTED).
    // The stage badge starts as "New · Awaiting acceptance".
    await expect(page.getByText(/awaiting acceptance/i).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /accept delivery/i }).click();
    await expect(page.getByText(/heading to pickup/i).first()).toBeVisible({ timeout: 10_000 });

    // ── Picked up (ACCEPTED → PICKED_UP).
    await page.getByRole('button', { name: /^picked up$/i }).click();
    await expect(page.getByText(/en route to customer/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
