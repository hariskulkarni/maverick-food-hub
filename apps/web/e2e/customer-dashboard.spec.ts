import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './fixtures/auth';

/**
 * Customer dashboard at `/r/<slug>/me`.
 *
 *   • Anonymous visit → redirected to `/r/<slug>/login`.
 *   • Signed-in customer sees the full dashboard: hero greeting, 3 KPI tiles
 *     (Wallet ₹X, Loyalty Y pts, Z orders), most-ordered, active offers,
 *     recent orders, saved addresses, wallet ledger, loyalty progress, and
 *     account actions.
 *
 * Server component: rendered from `src/app/(customer)/r/[slug]/me/page.tsx`
 * with a client child `me-client.tsx`. The page redirects pre-render via
 * `next/navigation`'s `redirect()` when the session is missing.
 */
test.describe('Customer dashboard `/r/<slug>/me`', () => {
  test('anonymous visitor is redirected to the tenant login', async ({ page, context }) => {
    // Clear cookies in case the worker re-uses storage state.
    await context.clearCookies();

    await page.goto('/r/saffron-smoke/me');
    await page.waitForURL(/\/r\/saffron-smoke\/login(\?|$)/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/r\/saffron-smoke\/login(\?|$)/);
  });

  test('signed-in customer sees hero + KPIs + all expected sections', async ({ page }) => {
    await signInAsCustomer(page);
    await page.goto('/r/saffron-smoke/me');

    // ── Hero greeting. The page renders either the customer's name or the
    // restaurant name "Saffron & Smoke" at the top. We accept either.
    const heroCandidates = page
      .getByRole('heading')
      .filter({ hasText: /saffron\s*(&|and)\s*smoke|hi[,!]?\s|hello|welcome|good (morning|afternoon|evening)/i });
    await expect(heroCandidates.first()).toBeVisible({ timeout: 10_000 });

    // ── Section labels. Soft-assert each so one missing section doesn't mask
    // the others; the suite still fails if any are missing.
    // "Most ordered" appears as "Most ordered here" in the section header.
    expect.soft(await page.getByText(/wallet/i).count(), 'Wallet section/label').toBeGreaterThan(0);
    expect.soft(await page.getByText(/loyalty/i).count(), 'Loyalty section/label').toBeGreaterThan(0);
    expect.soft(await page.getByText(/most ordered/i).count(), 'Most ordered section').toBeGreaterThan(0);
    expect.soft(await page.getByText(/active offers/i).count(), 'Active offers section').toBeGreaterThan(0);
    expect.soft(await page.getByText(/recent orders/i).count(), 'Recent orders section').toBeGreaterThan(0);
    expect.soft(await page.getByText(/saved addresses/i).count(), 'Saved addresses section').toBeGreaterThan(0);
    expect.soft(await page.getByText(/^account$/i).count(), 'Account section').toBeGreaterThan(0);

    // ── At least one KPI tile shows a currency value. The Wallet KPI uses
    // `money()` which prefixes ₹. We assert the rupee glyph appears in the
    // top KPI area — anywhere on the page is fine since the dashboard only
    // displays ₹ values (wallet balance, order totals, offers).
    await expect(page.getByText(/₹/).first()).toBeVisible();
  });
});
