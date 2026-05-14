import { test, expect, type Page } from '@playwright/test';
import { signInAsAdmin, signInAsCustomer } from './fixtures/auth';

/**
 * Restaurant-admin order workflow.
 *
 * To exercise the Accept → Preparing → Ready transitions we first place a
 * fresh COD order as the customer (so we know there's at least one
 * RECEIVED order on the board). Then we switch contexts to the admin and
 * walk it forward.
 *
 * Status pill text comes from STATUS_LABELS / OrderStatusBadge. We assert
 * by the visible label rather than a CSS class so the test stays resilient.
 */

async function placeFreshOrderAsCustomer(page: Page): Promise<string> {
  await signInAsCustomer(page);
  await page.goto('/r/saffron-smoke');
  const addButtons = page.getByRole('button', { name: /^add$/i });
  await addButtons.first().waitFor({ state: 'visible' });
  await addButtons.nth(0).click();
  await addButtons.first().click();
  await page.goto('/checkout');
  await page.getByRole('button', { name: /cash on delivery/i }).click();
  const placeBtn = page.getByRole('button', { name: /place order ·/i });
  await expect(placeBtn).toBeEnabled({ timeout: 10_000 });
  await placeBtn.click();
  await page.waitForURL(/\/orders\/[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  const headerText = await page.getByRole('heading', { name: /^order /i }).innerText();
  return headerText.replace(/^order\s+/i, '').trim();
}

test.describe('Restaurant admin: walk an order Accept → Preparing → Ready', () => {
  test('happy path through the orders board', async ({ page, browser }) => {
    // Place an order in a separate browser context so the customer's session
    // doesn't trample the admin's.
    const customerCtx = await browser.newContext();
    const customerPage = await customerCtx.newPage();
    const orderCode = await placeFreshOrderAsCustomer(customerPage);
    await customerCtx.close();

    // Now sign in as admin and walk the board.
    await signInAsAdmin(page);
    await page.goto('/admin/orders');
    await expect(page.getByRole('heading', { name: /^orders$/i })).toBeVisible();

    // Locate the card for our just-placed order. The card links the code
    // (rendered inside a Card), so we scope subsequent clicks via the card.
    const codeLink = page.getByRole('link', { name: orderCode }).first();
    await codeLink.waitFor({ state: 'visible', timeout: 15_000 });
    const card = page.locator('div.grid', { has: codeLink }).first();
    // Fallback if the structural locator doesn't pin down a single card —
    // walk up to the nearest CardContent.
    const orderCard = (await card.count()) > 0
      ? card
      : codeLink.locator('xpath=ancestor::*[contains(@class,"grid")][1]');

    // ── Accept (RECEIVED → ACCEPTED)
    await orderCard.getByRole('button', { name: /^accept$/i }).click();
    await expect(orderCard.getByText(/accepted/i).first()).toBeVisible({ timeout: 10_000 });

    // ── Start preparing (ACCEPTED → PREPARING)
    await orderCard.getByRole('button', { name: /start preparing/i }).click();
    await expect(orderCard.getByText(/preparing|cooking/i).first()).toBeVisible({ timeout: 10_000 });

    // ── Mark ready (PREPARING → READY). The button label is
    //   "Mark ready — release to rider pool". Match a substring.
    await orderCard.getByRole('button', { name: /mark ready/i }).click();
    await expect(orderCard.getByText(/^ready$|ready · |waiting for a rider/i).first()).toBeVisible({
      timeout: 10_000
    });
  });
});
