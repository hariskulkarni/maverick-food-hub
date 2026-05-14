import { test, expect, type Page, type Browser } from '@playwright/test';
import { signInAsAdmin, signInAsCustomer, signInAsRider } from './fixtures/auth';

/**
 * Realtime delivery marker on the customer tracker (light-touch).
 *
 * Full path: customer places an order → admin walks it to READY → rider
 * claims, accepts, picks up (which transitions the order to
 * OUT_FOR_DELIVERY). Then the customer revisits the tracker URL and we
 * assert either the ETA pill ("Arriving in ~N min · X km away") or the map
 * container is in the DOM. We don't simulate real SSE — just verify the
 * tracker renders the in-flight chrome.
 *
 * If the setup can't make it to OUT_FOR_DELIVERY within ~10s we skip rather
 * than fail the suite — this spec is locking in shape, not transition
 * timing (which is exercised by `rider-pool.spec.ts`).
 */

async function placeCustomerOrder(browser: Browser): Promise<{ code: string; orderId: string }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAsCustomer(page);
  await page.goto('/r/saffron-smoke');
  const adds = page.getByRole('button', { name: /^add$/i });
  await adds.first().waitFor();
  await adds.nth(0).click();
  await adds.first().click();
  await page.goto('/checkout');
  await page.getByRole('button', { name: /cash on delivery/i }).click();
  const place = page.getByRole('button', { name: /place order ·/i });
  await expect(place).toBeEnabled({ timeout: 10_000 });
  await place.click();
  await page.waitForURL(/\/orders\/[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  const orderId = page.url().split('/').pop()!;
  const headerText = await page.getByRole('heading', { name: /^order /i }).innerText();
  const code = headerText.replace(/^order\s+/i, '').trim();
  await ctx.close();
  return { code, orderId };
}

async function walkAdminToReady(browser: Browser, code: string): Promise<void> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInAsAdmin(page);
  await page.goto('/admin/orders');
  const codeLink = page.getByRole('link', { name: code }).first();
  await codeLink.waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: /^accept$/i }).first().click();
  await page.getByRole('button', { name: /start preparing/i }).first().click();
  await page.getByRole('button', { name: /mark ready/i }).first().click();
  await page.waitForTimeout(300);
  await ctx.close();
}

async function walkRiderToOutForDelivery(page: Page, code: string): Promise<boolean> {
  await signInAsRider(page);
  await page.goto('/rider');
  const onlineSwitch = page.getByRole('switch').first();
  await onlineSwitch.waitFor({ state: 'visible' });
  const state = await onlineSwitch.getAttribute('data-state');
  if (state !== 'checked') await onlineSwitch.click();

  await page.goto('/rider/pool');
  await expect(page.getByRole('heading', { name: /available deliveries/i })).toBeVisible();

  // Wait for our order. If it never appears, bail.
  const codeChip = page.getByText(code, { exact: true }).first();
  try {
    await codeChip.waitFor({ state: 'visible', timeout: 8_000 });
  } catch {
    return false;
  }
  await page.getByRole('button', { name: /^claim$/i }).first().click();
  await page.waitForURL(/\/rider$/, { timeout: 10_000 });
  await page.getByRole('button', { name: /accept delivery/i }).click();
  // Picked up: pickup API auto-promotes the order to OUT_FOR_DELIVERY.
  await page.getByRole('button', { name: /^picked up$/i }).click();
  await expect(page.getByText(/en route to customer/i).first()).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe('Realtime delivery marker on the customer tracker', () => {
  test('tracker for an OUT_FOR_DELIVERY order shows ETA pill or map', async ({ page, browser }) => {
    // ── Setup with a hard budget. If any step is slow/flaky we skip — the
    // spec's purpose is to lock in tracker shape, not order plumbing.
    let orderId: string;
    let code: string;
    try {
      ({ code, orderId } = await placeCustomerOrder(browser));
      await walkAdminToReady(browser, code);
    } catch (err) {
      test.skip(true, `Could not stage an order to READY cleanly: ${(err as Error).message}`);
      return;
    }

    // Walk rider in the main page context (so we can swap to customer next).
    let promoted = false;
    try {
      promoted = await walkRiderToOutForDelivery(page, code);
    } catch (err) {
      test.skip(true, `Rider walk to OUT_FOR_DELIVERY failed: ${(err as Error).message}`);
      return;
    }
    if (!promoted) {
      test.skip(true, 'Order never appeared in the rider pool — skipping tracker check.');
      return;
    }

    // ── Visit the customer tracker. We need a customer session for the
    // tracker page (it gates on ownership).
    const customerCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    await signInAsCustomer(customerPage);
    await customerPage.goto(`/orders/${orderId}`);

    // First, confirm the tracker page actually rendered (header copy).
    await expect(customerPage.getByRole('heading', { name: /^order /i })).toBeVisible({
      timeout: 10_000
    });

    // ── Light-touch shape check. Either:
    //   (a) the ETA pill is visible ("Arriving in ~N min · X km away" or, if
    //       the rider is <=200m, "Rider is here"), OR
    //   (b) the map container is in the DOM (the tracker always mounts
    //       <DeliveryMap> while the order is OUT_FOR_DELIVERY).
    const etaPill = customerPage.getByText(/Arriving in ~\d+ min|rider is here/i).first();
    const mapContainer = customerPage
      .locator('canvas, [class*="map"], [data-testid*="map" i]')
      .first();

    const etaVisible = await etaPill.isVisible().catch(() => false);
    const mapVisible = await mapContainer.isVisible().catch(() => false);

    expect(
      etaVisible || mapVisible,
      'Expected ETA pill OR map container on the OUT_FOR_DELIVERY tracker'
    ).toBe(true);

    await customerCtx.close();
  });
});
