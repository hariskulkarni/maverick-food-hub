import { test, expect } from '@playwright/test';

/**
 * Accessibility baseline for the landing page at `/`.
 *
 * Anonymous visit. Asserts:
 *   1. Exactly one <h1> on the page.
 *   2. Every interactive element (anchor / button) has either visible text
 *      or an aria-label.
 *   3. Every <img> has an `alt` attribute (decorative images use alt="").
 *   4. Tabbing through the first 10 focusable elements produces no console
 *      errors or page errors.
 *
 * We don't pull in `@axe-core/playwright` here — this spec deliberately
 * codifies the project-level a11y rules.
 */
test.describe('Landing a11y baseline', () => {
  test('home page passes the project a11y checks', async ({ page }) => {
    // Capture errors *before* navigating so we catch hydration errors too.
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // ── 1. Exactly one <h1>.
    const h1Count = await page.locator('h1').count();
    expect(h1Count, `Expected exactly one <h1>, found ${h1Count}`).toBe(1);

    // ── 2. Interactive elements must have an accessible name. We pull all
    // anchors and buttons and check each one. An empty accessible name is a
    // failure UNLESS the element is `aria-hidden="true"` or `hidden` (then
    // it's not in the AT tree anyway).
    const interactive = await page.locator('a, button').elementHandles();
    const missingNames: string[] = [];
    for (const handle of interactive) {
      const info = await handle.evaluate((node) => {
        const el = node as Element;
        const html = el as HTMLElement;
        const isHidden =
          el.getAttribute('aria-hidden') === 'true' ||
          html.hidden === true ||
          getComputedStyle(html).display === 'none' ||
          getComputedStyle(html).visibility === 'hidden';
        const text = (el.textContent ?? '').trim();
        const aria = el.getAttribute('aria-label') ?? '';
        const ariaLabelledBy = el.getAttribute('aria-labelledby') ?? '';
        const title = el.getAttribute('title') ?? '';
        // For buttons that wrap an <img>, the image alt counts.
        const innerImgAlt =
          (el.querySelector('img')?.getAttribute('alt') ?? '').trim() || '';
        return {
          tag: el.tagName.toLowerCase(),
          isHidden,
          text,
          aria,
          ariaLabelledBy,
          title,
          innerImgAlt,
          outer: html.outerHTML.slice(0, 160)
        };
      });
      if (info.isHidden) continue;
      const hasName =
        info.text.length > 0 ||
        info.aria.length > 0 ||
        info.ariaLabelledBy.length > 0 ||
        info.title.length > 0 ||
        info.innerImgAlt.length > 0;
      if (!hasName) {
        missingNames.push(`${info.tag}: ${info.outer}`);
      }
    }
    expect(
      missingNames,
      `Interactive elements without an accessible name:\n${missingNames.join('\n')}`
    ).toEqual([]);

    // ── 3. Every <img> must carry an `alt` attribute (empty alt is fine).
    const imgsMissingAlt = await page
      .locator('img:not([alt])')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).outerHTML.slice(0, 160)));
    expect(
      imgsMissingAlt,
      `<img> elements missing alt attribute:\n${imgsMissingAlt.join('\n')}`
    ).toEqual([]);

    // ── 4. Tab through the first 10 focusable elements. None should raise
    // a console / page error.
    await page.locator('body').focus();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
    }
    // Give async error handlers a tick to surface.
    await page.waitForTimeout(200);

    expect(pageErrors, `pageerror events fired:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error events fired:\n${consoleErrors.join('\n')}`).toEqual([]);
  });
});
