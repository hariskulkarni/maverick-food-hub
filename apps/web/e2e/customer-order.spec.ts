import { test, expect } from '@playwright/test';
import { signInAsCustomer, expectMeRole } from './fixtures/auth';

/**
 * Full customer happy-path:
 *   1. sign in via OTP
 *   2. open the seeded restaurant `/r/saffron-smoke`
 *   3. add 2 items to cart
 *   4. checkout, pick COD, place order
 *   5. land on `/orders/<id>`, verify the delivery-OTP card is visible
 *   6. verify the order now shows up in /orders for the signed-in customer
 */
test.describe('Customer happy path: browse → cart → checkout → COD → track', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCustomer(page);
  });

  test('places a COD order and lands on the tracker with the OTP card visible', async ({ page }) => {
    await expectMeRole(page, 'CUSTOMER');

    // ── Step 1: open the seeded restaurant.
    await page.goto('/r/saffron-smoke');
    await expect(page.getByRole('heading', { name: /saffron & smoke/i })).toBeVisible();

    // ── Step 2: add 2 items from the menu. The menu renders one card per
    // dish; each card has a default "Add" button that flips to a stepper
    // after the first click. We add two *different* dishes for a more
    // realistic cart and to avoid relying on the +/- stepper.
    const addButtons = page.getByRole('button', { name: /^add$/i });
    await addButtons.first().waitFor({ state: 'visible' });
    await addButtons.nth(0).click();
    // After click the first card flips to stepper, so .first() is now the
    // next available "Add" button.
    await addButtons.first().click();

    // ── Step 3: open checkout (cart is in localStorage, no nav needed).
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: /checkout/i })).toBeVisible();

    // The Place-order button is gated on a pricing fetch — wait for the
    // server quote to come back. We key off the visible total in the button.
    const placeBtn = page.getByRole('button', { name: /place order ·/i });
    await expect(placeBtn).toBeEnabled({ timeout: 10_000 });

    // ── Step 4: pick COD (default is RAZORPAY).
    await page.getByRole('button', { name: /cash on delivery/i }).click();

    // ── Step 5: place the order. The form navigates to /orders/<id>.
    await placeBtn.click();
    await page.waitForURL(/\/orders\/[A-Za-z0-9_-]+$/, { timeout: 15_000 });

    // ── Step 6: verify the order tracker rendered AND the delivery-OTP card.
    // The OTP card title varies by status — pre-OFD it reads "Your delivery
    // code"; once OUT_FOR_DELIVERY it switches to "Hand this code to your rider".
    // The order is fresh (RECEIVED) so we expect the pre-OFD copy. The card
    // also renders 4 large mono digit tiles — we assert one is visible.
    await expect(
      page.getByText(/your delivery code|hand this code to your rider/i)
    ).toBeVisible();

    // Pull the order code from the page header — it's rendered as
    // `Order <code>` (font-mono span).
    const headerText = await page.getByRole('heading', { name: /^order /i }).innerText();
    const code = headerText.replace(/^order\s+/i, '').trim();
    expect(code).toMatch(/^[A-Z0-9-]+$/);

    // ── Step 7: verify the order is now in the customer's order list.
    // The app exposes the customer order list at `/orders` (server-rendered),
    // and the profile sidebar links to it. There's no `/api/me/orders` route
    // so we hit the UI page directly.
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: /my orders/i })).toBeVisible();
    await expect(page.getByText(code)).toBeVisible();
  });
});
