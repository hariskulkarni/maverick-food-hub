import { test, expect } from '@playwright/test';
import { signInAsAdmin } from './fixtures/auth';

/**
 * Integrations wizard — Razorpay test path.
 *
 * Drives the integration wizard for Razorpay from /admin/settings:
 *   - find the Razorpay card
 *   - open the wizard (Configure / Manage button)
 *   - skip past the intro step
 *   - fill bogus credentials
 *   - click "Test connection"
 *   - assert the failure banner appears
 *   - do NOT save — close the dialog so no DB write happens
 *
 * The provider's test endpoint actually talks to Razorpay's API, so fake
 * keys reliably produce a failure result.
 */
test.describe('Admin · Integrations · Razorpay wizard failure path', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test('test connection with bogus creds shows an error banner', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: /^settings$/i })).toBeVisible();

    // Wait for the Integrations section to hydrate. The first request to
    // `/api/admin/integrations` returns the card list — if it 200s the
    // section flips out of its shimmer state.
    const razorpayCard = page.locator('div', {
      has: page.getByText(/razorpay/i)
    }).first();
    await razorpayCard.waitFor({ state: 'visible', timeout: 15_000 });

    // Open the wizard. Button copy is "Configure" when not yet connected,
    // "Manage" when connected — match either.
    await razorpayCard.getByRole('button', { name: /configure|manage/i }).click();

    // Dialog should be open with the wizard title.
    await expect(page.getByRole('dialog')).toBeVisible();

    // Step 1 = intro. If the integration was previously connected the
    // wizard skips straight to step 2; check for the "Get started" button
    // and click only if present.
    const getStarted = page.getByRole('button', { name: /get started/i });
    if (await getStarted.isVisible().catch(() => false)) {
      await getStarted.click();
    }

    // Step 2 = credentials. Razorpay's field defs (server-side) are
    // `keyId` + `keySecret`. We fill any visible inputs in the dialog —
    // labels vary by version. We type intentionally-bad strings so the
    // provider rejects them.
    const dialog = page.getByRole('dialog');
    const inputs = dialog.locator('input');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      await inputs.nth(i).fill(`rzp_test_bogus_${i}_${Date.now()}`);
    }

    // Click "Test connection". The wizard transitions to step 3 with a
    // success/failure banner. With bogus creds we expect failure.
    const testBtn = dialog.getByRole('button', { name: /test connection/i });
    await expect(testBtn).toBeEnabled();
    await testBtn.click();

    // Assert the failure banner. The wizard renders "Connection failed"
    // when the provider rejects credentials. We give it generous time
    // because the request actually hops to Razorpay over the network.
    await expect(dialog.getByText(/connection failed/i)).toBeVisible({ timeout: 30_000 });

    // Make doubly sure no "Save & enable" button was reached.
    await expect(dialog.getByRole('button', { name: /save.*enable/i })).toHaveCount(0);

    // Close without saving. Either via Escape or the close button —
    // Escape is the simplest cross-platform path.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
