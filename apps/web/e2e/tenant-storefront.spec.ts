import { test, expect } from '@playwright/test';
import { signInAsCustomer } from './fixtures/auth';

/**
 * Tenant storefront — anonymous vs signed-in customer behaviour.
 *
 *   1. Anonymous user can view `/r/saffron-smoke` (restaurant name visible).
 *   2. There is a "Sign in to order" CTA pointing at
 *      `/login?role=customer&next=/r/saffron-smoke`.
 *   3. After signing in as a customer the CTA is gone — replaced by the
 *      user menu / account chip.
 */
test.describe('Tenant storefront: sign-in CTA toggles by auth state', () => {
  test('anonymous sees "Sign in to order" CTA; customer does not', async ({ page, context }) => {
    // ── 1. Anonymous visit.
    await page.goto('/r/saffron-smoke');
    await expect(page.getByRole('heading', { name: /saffron & smoke/i })).toBeVisible({
      timeout: 10_000
    });

    // ── 2. The "Sign in to order" CTA must exist and link back to the
    // login page with role=customer and a next= param pointing here. We
    // match on the href rather than copy because different parts of the
    // page may render variants ("Sign in to order", "Log in to order").
    const ctaLinks = page.locator('a[href*="/login"]');
    const count = await ctaLinks.count();
    expect(count, 'Expected at least one /login link on storefront').toBeGreaterThan(0);

    let matched = false;
    for (let i = 0; i < count; i++) {
      const href = (await ctaLinks.nth(i).getAttribute('href')) ?? '';
      if (
        href.includes('/login?') &&
        /role=customer/.test(href) &&
        /next=.*r%2Fsaffron-smoke|next=\/r\/saffron-smoke/.test(href)
      ) {
        matched = true;
        break;
      }
    }
    expect(
      matched,
      'Expected a link with href containing /login?role=customer and next=/r/saffron-smoke'
    ).toBe(true);

    // Also assert the visible CTA text — at least one /login link uses the
    // expected copy.
    await expect(
      page.getByRole('link', { name: /sign in to order|log in to order/i }).first()
    ).toBeVisible();

    // ── 3. Sign in as customer and revisit. CTA should disappear.
    await signInAsCustomer(page);
    await page.goto('/r/saffron-smoke');
    await expect(page.getByRole('heading', { name: /saffron & smoke/i })).toBeVisible({
      timeout: 10_000
    });

    // No "Sign in to order" CTA anywhere on the page now.
    await expect(
      page.getByRole('link', { name: /sign in to order|log in to order/i })
    ).toHaveCount(0);

    // Clean up cookies so this spec doesn't leak state.
    await context.clearCookies();
  });
});
