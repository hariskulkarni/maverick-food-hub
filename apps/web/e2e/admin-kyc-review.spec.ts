import { test, expect } from '@playwright/test';
import { signInAsSuperAdmin } from './fixtures/auth';

/**
 * Super-admin KYC review queue (/platform/kyc).
 *
 * Asserts the contract of the queue page after rider-kyc.spec.ts has dropped
 * at least one PENDING doc into the queue:
 *   – Stats strip with 5 KPI tiles
 *   – Filter chips (All / Pending / Approved / Rejected / Expired) functional
 *   – At least one row visible (assuming a rider submission or seed)
 *   – Clicking a row opens the review drawer
 *      • drawer shows a masked number (XXXX XXXX 1234 / XXXXX#### / etc.)
 *      • doc preview region present (img / iframe / unsupported fallback)
 *      • Approve + Reject buttons present
 *      • Reject reveals a textarea; submit is disabled with an empty reason
 *      • Submitting a non-empty reason closes the drawer
 *
 * NB: the rider-kyc spec runs first by default (alphabetical order:
 * `admin-kyc-review.spec.ts` < `rider-kyc.spec.ts`), but `fullyParallel: false`
 * is set in playwright.config.ts and the queue page also covers any seeded
 * PENDING rows — so the test is robust either way.
 */

test.describe('Super-admin KYC review (/platform/kyc)', () => {
  test('queue contract: KPIs, filters, drawer, approve/reject buttons', async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto('/platform/kyc');

    // ── KPI strip with 5 tiles. The tiles render plain divs (not roles), but
    // they all live in the first `.grid` immediately after the header.
    const heading = page.getByRole('heading', { name: /^kyc review$/i });
    await expect(heading).toBeVisible();
    // The 5 KPI labels are exact strings in the component.
    for (const re of [
      /pending review/i,
      /approved · 30d/i,
      /rejected · 30d/i,
      /expiring · 30d/i,
      /^expired$/i
    ]) {
      await expect(page.getByText(re).first()).toBeVisible();
    }

    // ── Filter chips: status row carries "All / Pending / Approved /
    // Rejected / Expired" as text buttons.
    for (const re of [/^all$/i, /^pending$/i, /^approved$/i, /^rejected$/i, /^expired$/i]) {
      await expect(page.getByRole('button', { name: re })).toBeVisible();
    }

    // Click "Pending" — the chip toggles active styling and the URL gets
    // ?status=PENDING. We assert via URL because the visual style is
    // ephemeral.
    await page.getByRole('button', { name: /^pending$/i }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('status'), { timeout: 3_000 }).toBe('PENDING');
  });

  test('clicking a row opens the drawer with masked number and approve/reject', async ({ page }) => {
    await signInAsSuperAdmin(page);
    await page.goto('/platform/kyc?status=PENDING');

    // Wait for the table to settle. A pending row OR an empty-state are both
    // possible — if there are no pending rows we skip the deeper assertions
    // (the queue is data-dependent on rider seed / prior specs).
    await page.waitForLoadState('networkidle');

    const reviewButtons = page.getByRole('button', { name: /^review$/i });
    const reviewCount = await reviewButtons.count();
    test.skip(reviewCount === 0, 'No PENDING rows in queue — rider seed / rider-kyc.spec.ts must run first.');

    // Open the drawer on the first pending row.
    await reviewButtons.first().click();

    // ── Drawer opens. The DetailDrawer uses role="dialog".
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();

    // ── Masked number — the table + drawer both run text through
    // `maskNumber(type, last4)`. The four possible masked formats are:
    //   AADHAAR    XXXX XXXX 1234
    //   PAN        XXXXX####
    //   DL         XX-XX-XXXX-####
    //   RC         XX XX XXXX ####
    //   INSURANCE  ••••####
    // We assert at least one of these formats is rendered inside the drawer.
    await expect(drawer.getByText(/XXXX XXXX \d{4}|XXXXX\w{4}|XX-XX-XXXX-\w{4}|XX XX XXXX \w{4}|••••\w{4}/)).toBeVisible();

    // ── Document preview region. The drawer always renders one of:
    //   <img> for images, <iframe> for PDFs, or the unsupported-fallback.
    const previewImg = drawer.locator('img');
    const previewFrame = drawer.locator('iframe');
    const previewFallback = drawer.getByText(/preview not available/i);
    const previewPresent =
      (await previewImg.count()) > 0 ||
      (await previewFrame.count()) > 0 ||
      (await previewFallback.count()) > 0;
    expect(previewPresent, 'doc preview region present').toBe(true);

    // ── Approve and Reject buttons present.
    const approveBtn = drawer.getByRole('button', { name: /^approve$/i });
    const rejectBtn = drawer.getByRole('button', { name: /^reject$/i });
    await expect(approveBtn).toBeVisible();
    await expect(rejectBtn).toBeVisible();

    // ── Reject reveals a textarea. Submit is disabled while the reason is
    // empty.
    await rejectBtn.click();
    const reasonBox = drawer.locator('textarea');
    await expect(reasonBox).toBeVisible();

    const submitReject = drawer.getByRole('button', { name: /submit rejection/i });
    await expect(submitReject).toBeVisible();
    await expect(submitReject).toBeDisabled();

    // ── Fill a reason → submit becomes enabled → clicking it closes the drawer.
    await reasonBox.fill('Document is blurry; please re-upload a clearer scan.');
    await expect(submitReject).toBeEnabled();
    await submitReject.click();

    // Drawer closes — `act()` calls onClose() for reject/approve flows.
    await expect(drawer).toBeHidden({ timeout: 10_000 });
  });
});
