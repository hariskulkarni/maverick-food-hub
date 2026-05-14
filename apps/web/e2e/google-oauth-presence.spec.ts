import { test, expect } from '@playwright/test';

/**
 * Google OAuth on the tenant customer login.
 *
 * The "Continue with Google" button on `/r/<slug>/login` renders only when
 * the server sees `GOOGLE_CLIENT_ID` in the environment. The page passes
 * `googleEnabled={Boolean(process.env.GOOGLE_CLIENT_ID)}` to the client.
 *
 * We don't actually walk the OAuth flow — just assert presence/absence and
 * confirm the phone OTP form is always available.
 */
test.describe('Tenant login: Google OAuth button is env-gated', () => {
  test('button matches GOOGLE_CLIENT_ID env; OTP form always visible', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/r/saffron-smoke/login');

    // Wait for the login card to mount.
    await expect(page.getByRole('heading', { name: /saffron\s*(&|and)\s*smoke/i })).toBeVisible({
      timeout: 10_000
    });

    const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID);
    const googleBtn = page.getByRole('button', { name: /continue with google/i });

    if (googleEnabled) {
      await expect(
        googleBtn,
        'GOOGLE_CLIENT_ID is set; "Continue with Google" must render'
      ).toBeVisible();
    } else {
      await expect(
        googleBtn,
        'GOOGLE_CLIENT_ID is unset; "Continue with Google" must NOT render'
      ).toHaveCount(0);
    }

    // ── Phone OTP form is always the primary path. The phone input has id
    // `phone` (matches the rest of the login surfaces in the codebase).
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.getByRole('button', { name: /send otp/i })).toBeVisible();
  });
});
