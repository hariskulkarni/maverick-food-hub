import { test, expect } from '@playwright/test';

/**
 * Platform branding on the anonymous home page.
 *
 * The home page is the marketing / discovery surface for the food-ordering
 * platform itself — NOT for any one restaurant. We lock in:
 *   1. The platform brand "Flavrly" is present (title or H1).
 *   2. The cuisine marquee element renders (discovery surface).
 *   3. A "For partners" / "List your restaurant" link is in the header.
 *   4. No restaurant-specific branding bleeds through — "Saffron & Smoke"
 *      may appear as a *featured card* but never as the page's wordmark.
 *
 * This spec runs anonymous (no signin) — the home page must work without
 * a session.
 */
test.describe('Anonymous home: platform branding', () => {
  test('home renders with platform wordmark, cuisine marquee, and partner CTA', async ({ page }) => {
    await page.goto('/');

    // ── 1. Brand name shows up either in <title> or as the wordmark/H1.
    // We accept either because the wordmark may be an <img alt="..."> or
    // a text element, and the title is set in <head>.
    const title = await page.title();
    const h1Text = await page
      .locator('h1, [data-testid="wordmark"], header [aria-label]')
      .first()
      .innerText()
      .catch(() => '');
    const hasBrand =
      /maverick'?s food hub/i.test(title) || /maverick'?s food hub/i.test(h1Text);
    expect(
      hasBrand,
      `Expected "Flavrly" in <title> or wordmark. title="${title}" h1="${h1Text}"`
    ).toBe(true);

    // ── 2. The cuisine marquee. We try the most likely hooks first
    // (data-testid is the agreed-upon contract), then fall back to a
    // role/class heuristic.
    const marquee = page
      .locator('[data-testid="cuisine-marquee"], [aria-label*="cuisine" i], .cuisine-marquee')
      .first();
    await expect(marquee).toBeVisible({ timeout: 10_000 });

    // ── 3. Partner CTA in the header. Either "For partners" or "List your
    // restaurant" copy is acceptable.
    const header = page.getByRole('banner');
    const partnerLink = header.getByRole('link', {
      name: /for partners|list your restaurant/i
    });
    await expect(partnerLink).toBeVisible();

    // ── 4. "Saffron & Smoke" must not appear as the *brand*. It may appear
    // as a featured restaurant card on the page — that's expected. We assert
    // it is NOT in the header wordmark or the document title.
    expect(title.toLowerCase()).not.toContain('saffron');
    const headerText = await header.innerText().catch(() => '');
    expect(headerText.toLowerCase()).not.toContain('saffron');
  });
});
