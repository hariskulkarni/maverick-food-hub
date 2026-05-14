import { test, expect, devices } from '@playwright/test';

/**
 * Premium landing page at `/` — anonymous visit.
 *
 * Asserts the platform-grade landing surface for "Maverick's Food Hub":
 *   1. Brand wordmark / page title.
 *   2. Restaurant directory section with at least one card.
 *   3. Three value-prop sections — Customer / Restaurant Owner / Rider
 *      (asserted soft so a small structural change doesn't sink the spec).
 *   4. Footer landmark with navigation links.
 *   5. Mobile (375x667) reflow — no horizontal overflow.
 *
 * Runs anonymous — the landing page must render without a session.
 */
test.describe('Landing page: premium platform surface', () => {
  test('renders brand, directory, value-props, and footer for anonymous visitor', async ({
    page
  }) => {
    await page.goto('/');

    // ── 1. Brand: <title> or h1/wordmark must mention "Maverick's Food Hub".
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
      `Expected "Maverick's Food Hub" in <title> or wordmark. title="${title}" h1="${h1Text}"`
    ).toBe(true);

    // ── 2. Restaurant directory. We try the obvious testid hooks first, then
    // fall back to a "directory" / "restaurants" heading and search for cards
    // (links into /r/<slug>) within that section.
    const directory = page
      .locator(
        '[data-testid="restaurant-directory"], [aria-label*="restaurants" i], section:has(a[href^="/r/"])'
      )
      .first();
    await expect(directory).toBeVisible({ timeout: 10_000 });
    const directoryCards = directory.locator('a[href^="/r/"]');
    expect(await directoryCards.count(), 'Expected at least one restaurant card').toBeGreaterThan(
      0
    );

    // ── 3. Three value-prop sections (Customer / Restaurant / Rider). These
    // are soft because the marketing team may rename the labels slightly.
    // We look for any text node matching each label inside a section/article.
    const valueProps: Array<[string, RegExp]> = [
      ['Customer', /customer/i],
      ['Restaurant', /restaurant\s*owner|for restaurants|partner/i],
      ['Rider', /rider|courier|driver/i]
    ];
    for (const [label, rx] of valueProps) {
      const match = page
        .locator('section, article, [data-testid*="value" i]')
        .filter({ hasText: rx })
        .first();
      await expect
        .soft(match, `Expected a value-prop section for ${label}`)
        .toBeVisible({ timeout: 5_000 });
    }

    // ── 4. Footer landmark with at least one nav link.
    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();
    const footerLinks = footer.getByRole('link');
    expect(
      await footerLinks.count(),
      'Expected the footer to carry navigation links'
    ).toBeGreaterThan(0);
  });

  test('reflows cleanly on mobile (375x667) with no horizontal overflow', async ({ browser }) => {
    // Fresh context at the iPhone-ish viewport.
    const context = await browser.newContext({ ...devices['iPhone SE'] });
    const page = await context.newPage();
    try {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');

      // Title still loads.
      const title = await page.title();
      expect(/maverick'?s food hub/i.test(title)).toBe(true);

      // Footer still present.
      await expect(page.getByRole('contentinfo')).toBeVisible({ timeout: 10_000 });

      // No horizontal overflow: documentElement.scrollWidth must be <= viewport
      // width (allow 1px slack for sub-pixel rounding).
      const overflow = await page.evaluate(() => {
        const el = document.documentElement;
        return { sw: el.scrollWidth, cw: el.clientWidth };
      });
      expect(
        overflow.sw,
        `Page overflows horizontally on mobile: scrollWidth=${overflow.sw} clientWidth=${overflow.cw}`
      ).toBeLessThanOrEqual(overflow.cw + 1);
    } finally {
      await context.close();
    }
  });
});
