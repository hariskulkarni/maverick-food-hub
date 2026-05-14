import { test, expect } from '@playwright/test';
import { requestOtp, SEEDED, expectMeRole } from './fixtures/auth';

/**
 * The redesigned `/login` page is a 4-tile role picker:
 *   Customer · Rider · Staff · Super Admin
 *
 * Picking a tile reveals the corresponding sign-in form. Customer + Rider
 * use phone+OTP; Staff + Super Admin use email + password.
 *
 * Specs:
 *   1. All four tiles exist with the right copy.
 *   2. Clicking Staff reveals the email/password form.
 *   3. Clicking Rider reveals the phone form.
 *   4. `?role=staff` deep-link pre-selects Staff (form visible without click).
 *   5. End-to-end customer sign-in *through* the role picker still works.
 */
test.describe('Login role picker', () => {
  test('shows 4 role tiles and reveals the right form per role', async ({ page }) => {
    await page.goto('/login');

    // ── 1. All four role tiles exist. We grab them by accessible name
    // (button or link or radio) — the picker may use any of these roles.
    for (const name of [/^customer$/i, /^rider$/i, /^staff$/i, /^super admin$/i]) {
      const tile = page
        .getByRole('button', { name })
        .or(page.getByRole('link', { name }))
        .or(page.getByRole('radio', { name }))
        .or(page.getByRole('tab', { name }))
        .first();
      await expect(tile, `Expected role tile for ${name}`).toBeVisible();
    }

    // ── 2. Click Staff → email + password form.
    await page
      .getByRole('button', { name: /^staff$/i })
      .or(page.getByRole('link', { name: /^staff$/i }))
      .or(page.getByRole('radio', { name: /^staff$/i }))
      .or(page.getByRole('tab', { name: /^staff$/i }))
      .first()
      .click();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();

    // ── 3. Click Rider → phone form.
    await page
      .getByRole('button', { name: /^rider$/i })
      .or(page.getByRole('link', { name: /^rider$/i }))
      .or(page.getByRole('radio', { name: /^rider$/i }))
      .or(page.getByRole('tab', { name: /^rider$/i }))
      .first()
      .click();
    await expect(page.locator('#phone')).toBeVisible();
  });

  test('?role=staff deep link pre-selects the staff form', async ({ page }) => {
    await page.goto('/login?role=staff');
    // Staff form should be visible *without* any clicks.
    await expect(page.locator('#email')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#password')).toBeVisible();
  });

  test('end-to-end customer sign-in through the role picker', async ({ page }) => {
    await page.goto('/login');

    // Click the Customer tile.
    await page
      .getByRole('button', { name: /^customer$/i })
      .or(page.getByRole('link', { name: /^customer$/i }))
      .or(page.getByRole('radio', { name: /^customer$/i }))
      .or(page.getByRole('tab', { name: /^customer$/i }))
      .first()
      .click();

    // Phone form is now the active form.
    await expect(page.locator('#phone')).toBeVisible();

    // Drive the OTP flow. We pull the dev code from the API so the test
    // is fast and deterministic.
    const devCode = await requestOtp(page.request, SEEDED.customer.phone);
    await page.locator('#phone').fill(SEEDED.customer.phone);
    await page.getByRole('button', { name: /send otp/i }).click();
    await page.locator('#otp').waitFor({ state: 'visible' });
    await page.locator('#otp').fill(devCode);
    await page.getByRole('button', { name: /verify.*sign in/i }).click();

    // Customers land on `/` (or one of the post-login surfaces) per
    // routeByRole.
    await page.waitForURL(/\/(?:$|profile|orders|menu|r\/)/, { timeout: 15_000 });
    await expectMeRole(page, 'CUSTOMER');
  });
});
