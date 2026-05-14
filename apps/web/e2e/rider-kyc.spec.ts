import { test, expect } from '@playwright/test';
import path from 'node:path';
import { signInAsRider } from './fixtures/auth';

/**
 * Rider KYC mobile spec (iPhone 14 Pro viewport, 390×844).
 *
 * The rider KYC screen at /rider/kyc must:
 *   1. Render five document cards (Aadhaar, DL, Insurance, RC, PAN).
 *   2. Show a hero status banner with a progress indicator.
 *   3. Be reachable from the rider account menu via a /rider/kyc link.
 *   4. NEVER expose a 12-digit unmasked Aadhaar number anywhere on the page —
 *      we assert `\b\d{12}\b` doesn't match anything in the DOM text.
 *   5. Accept an uploaded document via the hidden file input and flip the
 *      card to PENDING with a masked number.
 *
 * The seed has rider +919876500011 (Sandeep K.).
 */

const IPHONE_14_PRO = { width: 390, height: 844 };
const AADHAAR_FIXTURE = path.join(__dirname, 'fixtures', 'dummy-aadhaar.jpg');

test.use({ viewport: IPHONE_14_PRO });

test.describe('Rider KYC (/rider/kyc)', () => {
  test('renders 5 cards, hero, account-menu link, no unmasked Aadhaar', async ({ page }) => {
    await signInAsRider(page);

    // The rider account menu (avatar button, top-right) houses the KYC link.
    // We assert the link exists before navigating to /rider/kyc directly.
    await page.goto('/rider');
    await page.getByRole('button', { name: /account menu/i }).click();
    const kycLink = page.getByRole('link', { name: /documents.*kyc/i });
    await expect(kycLink).toBeVisible();
    await expect(kycLink).toHaveAttribute('href', '/rider/kyc');

    // Navigate to the KYC page (close the sheet first by clicking the link).
    await kycLink.click();
    await page.waitForURL(/\/rider\/kyc$/, { timeout: 10_000 });

    // ── Hero status banner. The component labels its heading with
    // id="kyc-hero-title"; assert the section is visible.
    const hero = page.locator('#kyc-hero-title').first();
    await expect(hero).toBeVisible();

    // The hero subtitle includes either a "<n> of <m> approved" progress
    // count or one of the terminal banners (Verified rider / Action needed /
    // Renew documents). Both are valid hero states — the spec only requires
    // a visible progress indicator on the banner.
    const heroSection = hero.locator('xpath=ancestor::section[1]');
    await expect(heroSection).toBeVisible();
    await expect(heroSection).toContainText(
      /approved|verified rider|action needed|renew documents/i
    );

    // ── Five required document cards: Aadhaar, DL, Insurance, RC, PAN.
    // Each card renders a heading with the document label.
    const labels = [
      /aadhaar/i,
      /driving licence/i,
      /vehicle insurance/i,
      /vehicle rc/i,
      /pan card/i
    ];
    for (const re of labels) {
      await expect(page.getByRole('heading', { name: re })).toBeVisible();
    }

    // ── No unmasked 12-digit number anywhere on the page. The regex
    // `\b\d{12}\b` must not match any visible text node. We pass it through
    // Playwright's :text-matches selector and assert a count of zero.
    const twelveDigit = page.locator(':text-matches("\\b\\d{12}\\b")');
    expect(await twelveDigit.count()).toBe(0);
  });

  test('uploading an Aadhaar document flips the card to PENDING with a masked number', async ({ page }) => {
    await signInAsRider(page);
    await page.goto('/rider/kyc');

    // Find the Aadhaar card by its heading, then walk to its containing
    // <section>. The upload form lives inside the same section when the
    // card has no current document.
    const aadhaarCard = page.getByRole('heading', { name: /^aadhaar card$/i }).locator('xpath=ancestor::section[1]');
    await expect(aadhaarCard).toBeVisible();

    // If this rider has already uploaded Aadhaar in a previous run, click
    // "Replace document" so we land on the upload form for sure. Otherwise
    // the form is already visible.
    const replaceBtn = aadhaarCard.getByRole('button', { name: /replace document|upload again|upload new/i });
    if (await replaceBtn.count()) {
      await replaceBtn.first().click();
    }

    // Set the file directly on the hidden <input type="file"> (the drop zone
    // proxy-clicks this input). Then fill the number, then submit.
    const fileInput = aadhaarCard.locator('input[type="file"]');
    await fileInput.setInputFiles(AADHAAR_FIXTURE);

    // The number field is the only <input type="text"> in the upload form.
    const numberField = aadhaarCard.locator('input[type="text"]').first();
    await numberField.fill('234512345678');

    // Submit. Button label is "Upload" on first submit, "Replace" when the
    // existingId path is taken.
    const submit = aadhaarCard.getByRole('button', { name: /^(upload|replace)$/i });
    await expect(submit).toBeEnabled({ timeout: 5_000 });
    await submit.click();

    // After the POST resolves and the parent re-fetches, the Aadhaar card
    // should show the PENDING status pill ("Awaiting review") and a masked
    // number ending in 5678. We give the network round-trip up to 15s.
    await expect(aadhaarCard.getByText(/awaiting review|pending/i)).toBeVisible({ timeout: 15_000 });
    await expect(aadhaarCard.getByText(/XXXX XXXX 5678/)).toBeVisible();

    // The unmasked 12-digit number must NOT appear anywhere on the page.
    const twelveDigit = page.locator(':text-matches("\\b\\d{12}\\b")');
    expect(await twelveDigit.count()).toBe(0);
  });
});
