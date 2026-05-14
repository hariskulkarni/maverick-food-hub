import { test, expect } from '@playwright/test';

/**
 * Platform home is B2B.
 *
 * `/` is now the partner-acquisition surface — for restaurants and riders, not
 * eaters. The header rebuild (`src/components/landing/platform-nav.tsx`) is
 * pathname-aware: anything outside `/r/<slug>` gets the marketing chrome.
 *
 * Locks in:
 *   1. NO cart icon anywhere on the page (no `[aria-label*="cart" i]`).
 *   2. NO button or link with the visible text "Order now".
 *   3. CTA link → `/signup/restaurant` with visible text including
 *      "List your restaurant".
 *   4. CTA link → `/signup/rider`.
 *   5. Small secondary "Already a partner? Sign in" link whose href starts
 *      with `/login` and includes `role=staff`.
 *
 * The cart icon CAN still appear on `/r/<slug>/*` — that's covered by other
 * specs. The point here is `/` is clean.
 */
test.describe('Platform home (B2B): no cart, no "Order now", partner CTAs', () => {
  test('anonymous /: cart absent, partner CTAs present, no consumer chrome', async ({ page }) => {
    await page.goto('/');

    // ── 1. No cart icon. The CartButton on the tenant nav has no aria-label,
    // so this is a belt-and-braces check that nothing on `/` exposes one
    // either. Case-insensitive substring match.
    await expect(page.locator('[aria-label*="cart" i]')).toHaveCount(0);

    // ── 2. No "Order now" button or link. Match the role + accessible name
    // explicitly so we don't accidentally hit body text that happens to
    // contain the phrase.
    await expect(page.getByRole('button', { name: /^order now$/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /^order now$/i })).toHaveCount(0);

    // ── 3. "List your restaurant" → /signup/restaurant. There may be more
    // than one such link (hero + mobile sheet); we just require at least one
    // to be visible.
    const listLinks = page.locator('a[href="/signup/restaurant"]');
    await expect(listLinks.first()).toBeVisible();
    const listCount = await listLinks.count();
    let foundListCopy = false;
    for (let i = 0; i < listCount; i++) {
      const txt = (await listLinks.nth(i).textContent())?.trim() ?? '';
      if (/list your restaurant/i.test(txt)) {
        foundListCopy = true;
        break;
      }
    }
    expect(
      foundListCopy,
      'Expected a link with href=/signup/restaurant whose text includes "List your restaurant"'
    ).toBe(true);

    // ── 4. "Become a rider" → /signup/rider. At least one such anchor.
    const riderLinks = page.locator('a[href="/signup/rider"]');
    await expect(riderLinks.first()).toBeVisible();

    // ── 5. Small "Already a partner? Sign in" link → /login?role=staff.
    // Search by href first (more reliable than copy), then sanity-check the
    // surrounding text contains "Already a partner".
    const staffLogin = page.locator('a[href^="/login"]').filter({
      hasText: /sign in/i
    });
    const staffCount = await staffLogin.count();
    let matched = false;
    for (let i = 0; i < staffCount; i++) {
      const href = (await staffLogin.nth(i).getAttribute('href')) ?? '';
      if (href.startsWith('/login') && /role=staff/.test(href)) {
        matched = true;
        break;
      }
    }
    expect(
      matched,
      'Expected a "Sign in" link with href starting /login and including role=staff'
    ).toBe(true);

    // The "Already a partner?" copy lives near the link in the hero — assert
    // the phrase appears somewhere on the page.
    await expect(page.getByText(/already a partner\??/i).first()).toBeVisible();
  });
});
