import { test, expect } from '@playwright/test';
import { SEEDED } from './fixtures/auth';

/**
 * Per-restaurant login routes under `/r/<slug>/login` and `/r/<slug>/staff`.
 *
 * The seeded restaurant `saffron-smoke` ("Saffron & Smoke") is owned by the
 * `admin@restaurant.local` admin, so signing in as that admin from the staff
 * route should land on `/admin/*`.
 *
 * Specs:
 *   1. `/r/saffron-smoke` (anon) shows a prominent "Sign in" CTA whose href
 *      points at `/r/saffron-smoke/login` (URL-encoded `next` is fine).
 *   2. `/r/saffron-smoke/login` references the restaurant name, carries a
 *      phone OTP form for customers, plus a staff-login link/tab.
 *   3. `/r/saffron-smoke/staff` references the restaurant name and carries
 *      the email/password form.
 *   4. Signing in as admin from `/r/saffron-smoke/staff` lands on `/admin/*`.
 *   5. An unknown slug yields a 404 / graceful "not found".
 */
test.describe('Tenant login routes', () => {
  test('storefront has a "Sign in" CTA that links to /r/saffron-smoke/login', async ({ page }) => {
    await page.goto('/r/saffron-smoke');

    // Find any link whose href targets the tenant login route. The CTA may
    // pass a URL-encoded `next` param, e.g. /r/saffron-smoke/login?next=...
    // We match on the path prefix so both shapes are accepted.
    const ctaLinks = page.locator('a[href*="/r/saffron-smoke/login"]');
    expect(
      await ctaLinks.count(),
      'Expected a sign-in CTA linking to /r/saffron-smoke/login'
    ).toBeGreaterThan(0);

    // At least one of those links should be visible (the prominent CTA).
    await expect(ctaLinks.first()).toBeVisible();
  });

  test('tenant /login page surfaces restaurant name, phone OTP form, and staff link', async ({
    page
  }) => {
    await page.goto('/r/saffron-smoke/login');

    // ── Restaurant name appears somewhere on the page.
    await expect(page.getByText(/saffron\s*&\s*smoke/i).first()).toBeVisible({
      timeout: 10_000
    });

    // ── Phone OTP form for customers. We accept either an explicit phone
    // input (#phone) or a tel-typed input.
    const phoneInput = page.locator('#phone, input[type="tel"]').first();
    await expect(phoneInput).toBeVisible({ timeout: 10_000 });

    // ── Link or tab to staff login. Accept several copies — "Staff", "Staff
    // sign in", "Restaurant staff", or a direct href to .../staff.
    const staffLink = page
      .getByRole('link', { name: /staff/i })
      .or(page.getByRole('tab', { name: /staff/i }))
      .or(page.locator('a[href*="/r/saffron-smoke/staff"]'));
    await expect(staffLink.first()).toBeVisible();
  });

  test('tenant /staff page surfaces email/password form and restaurant name', async ({ page }) => {
    await page.goto('/r/saffron-smoke/staff');

    // Restaurant name visible.
    await expect(page.getByText(/saffron\s*&\s*smoke/i).first()).toBeVisible({
      timeout: 10_000
    });

    // Email + password inputs.
    await expect(page.locator('#email, input[type="email"]').first()).toBeVisible();
    await expect(page.locator('#password, input[type="password"]').first()).toBeVisible();
  });

  test('admin sign-in from /r/saffron-smoke/staff lands on /admin/*', async ({ page, context }) => {
    await page.goto('/r/saffron-smoke/staff');

    await page.locator('#email, input[type="email"]').first().fill(SEEDED.admin.email);
    await page.locator('#password, input[type="password"]').first().fill(SEEDED.admin.password);

    // The submit button copy may be "Sign in", "Log in", or "Continue".
    const submit = page
      .getByRole('button', { name: /^sign in$/i })
      .or(page.getByRole('button', { name: /^log in$/i }))
      .or(page.getByRole('button', { name: /continue/i }));
    await submit.first().click();

    await page.waitForURL(/\/admin(?:\/|$|\?)/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/admin(?:\/|$|\?)/);

    // Clean up so this spec doesn't leak session state.
    await context.clearCookies();
  });

  test('unknown tenant slug returns 404 or graceful not-found', async ({ page }) => {
    const resp = await page.goto('/r/no-such-restaurant/login');

    // Either the HTTP response is a 404, OR the body shows a not-found UI.
    // Some Next apps render not-found.tsx with a 200, so we accept both.
    const status = resp?.status() ?? 0;
    if (status === 404) {
      expect(status).toBe(404);
    } else {
      // Body must mention "not found" / "404" / "doesn't exist".
      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      expect(
        /not found|404|doesn'?t exist|no such restaurant|couldn'?t find/.test(bodyText),
        `Expected a graceful not-found body for unknown slug; got: ${bodyText.slice(0, 200)}`
      ).toBe(true);
    }
  });
});
