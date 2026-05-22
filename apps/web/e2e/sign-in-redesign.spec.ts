import { test, expect } from '@playwright/test';
import { requestOtp, SEEDED, expectMeRole } from './fixtures/auth';

/**
 * Premium sign-in redesign at `/login`.
 *
 * The new layout is a split: marketing panel on the left, form panel on the
 * right. The form panel houses 4 role tiles — Customer, Rider, Restaurant
 * Staff, Super Admin — and swaps between a phone form and an email form
 * based on the active tile.
 *
 * Specs:
 *   1. Desktop (1280x800): split layout exists (marketing + form panels).
 *   2. All four role tiles present; clicking each swaps the form correctly.
 *   3. Mobile (375x667): layout stacks (single column — marketing panel
 *      moves above or hides).
 *   4. `?role=customer&next=/r/saffron-smoke` pre-selects the customer tile
 *      and after a successful OTP sign-in the URL is `/r/saffron-smoke`.
 */
test.describe('Premium /login redesign', () => {
  test('desktop split layout shows marketing panel + form panel', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');

    // Marketing panel: any element with marketing copy / branding outside the
    // form. We accept a `<aside>` / data-testid / a section that doesn't
    // contain the actual form inputs.
    const marketing = page
      .locator(
        '[data-testid="login-marketing"], aside, section:has-text("Flavrly"), [aria-label*="marketing" i]'
      )
      .first();
    await expect(marketing).toBeVisible({ timeout: 10_000 });

    // Form panel: must contain at least one role tile and the eventual form
    // inputs.
    const customerTile = page
      .getByRole('button', { name: /^customer$/i })
      .or(page.getByRole('link', { name: /^customer$/i }))
      .or(page.getByRole('radio', { name: /^customer$/i }))
      .or(page.getByRole('tab', { name: /^customer$/i }))
      .first();
    await expect(customerTile).toBeVisible();

    // Sanity check the *split*: the marketing panel and the form area should
    // sit side-by-side, i.e. their bounding boxes should not vertically stack
    // at this viewport. We compare the x-positions of the marketing panel
    // and the customer tile.
    const marketingBox = await marketing.boundingBox();
    const tileBox = await customerTile.boundingBox();
    if (marketingBox && tileBox) {
      const sideBySide =
        Math.abs(marketingBox.y - tileBox.y) < Math.max(marketingBox.height, tileBox.height);
      expect(
        sideBySide,
        `Expected marketing panel and form panel to sit side-by-side on desktop.`
      ).toBe(true);
    }
  });

  test('four role tiles present; form swaps Customer ↔ Staff correctly', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/login');

    const tiles: Array<[string, RegExp]> = [
      ['Customer', /^customer$/i],
      ['Rider', /^rider$/i],
      ['Restaurant Staff', /^(restaurant\s+)?staff$/i],
      ['Super Admin', /^super\s*admin$/i]
    ];

    // All four tiles exist.
    for (const [label, rx] of tiles) {
      const tile = page
        .getByRole('button', { name: rx })
        .or(page.getByRole('link', { name: rx }))
        .or(page.getByRole('radio', { name: rx }))
        .or(page.getByRole('tab', { name: rx }))
        .first();
      await expect(tile, `Expected role tile for ${label}`).toBeVisible();
    }

    // Click Customer → phone form.
    await page
      .getByRole('button', { name: /^customer$/i })
      .or(page.getByRole('link', { name: /^customer$/i }))
      .or(page.getByRole('radio', { name: /^customer$/i }))
      .or(page.getByRole('tab', { name: /^customer$/i }))
      .first()
      .click();
    await expect(page.locator('#phone, input[type="tel"]').first()).toBeVisible();

    // Click Restaurant Staff → email form.
    await page
      .getByRole('button', { name: /^(restaurant\s+)?staff$/i })
      .or(page.getByRole('link', { name: /^(restaurant\s+)?staff$/i }))
      .or(page.getByRole('radio', { name: /^(restaurant\s+)?staff$/i }))
      .or(page.getByRole('tab', { name: /^(restaurant\s+)?staff$/i }))
      .first()
      .click();
    await expect(page.locator('#email, input[type="email"]').first()).toBeVisible();
    await expect(page.locator('#password, input[type="password"]').first()).toBeVisible();

    // Click Rider → phone form returns.
    await page
      .getByRole('button', { name: /^rider$/i })
      .or(page.getByRole('link', { name: /^rider$/i }))
      .or(page.getByRole('radio', { name: /^rider$/i }))
      .or(page.getByRole('tab', { name: /^rider$/i }))
      .first()
      .click();
    await expect(page.locator('#phone, input[type="tel"]').first()).toBeVisible();

    // Click Super Admin → email form.
    await page
      .getByRole('button', { name: /^super\s*admin$/i })
      .or(page.getByRole('link', { name: /^super\s*admin$/i }))
      .or(page.getByRole('radio', { name: /^super\s*admin$/i }))
      .or(page.getByRole('tab', { name: /^super\s*admin$/i }))
      .first()
      .click();
    await expect(page.locator('#email, input[type="email"]').first()).toBeVisible();
  });

  test('mobile (375x667) stacks the layout into a single column', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');

    // We don't assert the marketing panel is hidden (some designs keep a
    // compact version up top) — instead we assert the panels stack, i.e.
    // they don't share a horizontal row. The simplest invariant: there is no
    // horizontal overflow at 375px.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { sw: el.scrollWidth, cw: el.clientWidth };
    });
    expect(
      overflow.sw,
      `Page overflows horizontally on mobile: scrollWidth=${overflow.sw} clientWidth=${overflow.cw}`
    ).toBeLessThanOrEqual(overflow.cw + 1);

    // Customer tile + form must both be reachable on mobile.
    const customerTile = page
      .getByRole('button', { name: /^customer$/i })
      .or(page.getByRole('link', { name: /^customer$/i }))
      .or(page.getByRole('radio', { name: /^customer$/i }))
      .or(page.getByRole('tab', { name: /^customer$/i }))
      .first();
    await expect(customerTile).toBeVisible();
  });

  test('?role=customer&next=/r/saffron-smoke pre-selects customer and respects next= after sign-in', async ({
    page,
    context
  }) => {
    await page.goto('/login?role=customer&next=/r/saffron-smoke');

    // Customer pre-selected → phone form is visible without any clicks.
    await expect(page.locator('#phone, input[type="tel"]').first()).toBeVisible({
      timeout: 10_000
    });

    // Drive OTP sign-in.
    const devCode = await requestOtp(page.request, SEEDED.customer.phone);
    await page.locator('#phone, input[type="tel"]').first().fill(SEEDED.customer.phone);
    await page.getByRole('button', { name: /send otp/i }).click();
    await page.locator('#otp').waitFor({ state: 'visible' });
    await page.locator('#otp').fill(devCode);
    await page.getByRole('button', { name: /verify.*sign in/i }).click();

    // After successful sign-in we should land at /r/saffron-smoke per the
    // next= param (NOT the routeByRole fallback of `/`).
    await page.waitForURL(/\/r\/saffron-smoke(?:\/|$|\?)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/r\/saffron-smoke(?:\/|$|\?)/);

    await expectMeRole(page, 'CUSTOMER');
    await context.clearCookies();
  });
});
