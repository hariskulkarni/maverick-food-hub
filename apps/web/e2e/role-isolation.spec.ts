import { test, expect } from '@playwright/test';
import { signInAsRider, expectMeRole } from './fixtures/auth';

/**
 * Role-isolation: a signed-in rider must not be able to wander into the
 * customer-facing surfaces. The middleware bounces RIDER users back to
 * `/rider` from any non-rider route.
 *
 * Flow:
 *   1. Sign in as the seeded rider (+919876500011).
 *   2. Try `/`, `/r/saffron-smoke`, `/profile`, `/checkout` — each must
 *      redirect to `/rider`.
 *   3. Clear cookies (sign out) and confirm anonymous users CAN still
 *      reach `/r/saffron-smoke` (so we're not over-blocking).
 */
test.describe('Role isolation: rider is pinned to /rider', () => {
  test('rider sessions bounce off customer routes; anon can reach the storefront', async ({
    page,
    context
  }) => {
    await signInAsRider(page);
    await expectMeRole(page, 'RIDER');

    // Each of these should end up on /rider after the middleware kicks in.
    const blockedRoutes = ['/', '/r/saffron-smoke', '/profile', '/checkout'];
    for (const route of blockedRoutes) {
      await page.goto(route);
      // The middleware does a 30x to /rider; waitForURL handles both
      // server-side and client-side redirects.
      await page.waitForURL(/\/rider(?:\/|$|\?)/, { timeout: 10_000 });
      expect(page.url(), `Expected ${route} → /rider`).toMatch(/\/rider(?:\/|$|\?)/);
    }

    // ── Sign out by clearing cookies. The app uses NextAuth session cookies;
    // wiping them deauthenticates without depending on a UI button (which
    // lives on /profile — a route the rider can't even reach).
    await context.clearCookies();

    // Anonymous user must still be able to load the storefront — we are
    // testing isolation, not lockdown.
    await page.goto('/r/saffron-smoke');
    await expect(page).toHaveURL(/\/r\/saffron-smoke/);
    // The restaurant name should render (anonymous view of the tenant page).
    await expect(page.getByRole('heading', { name: /saffron & smoke/i })).toBeVisible({
      timeout: 10_000
    });
  });
});
