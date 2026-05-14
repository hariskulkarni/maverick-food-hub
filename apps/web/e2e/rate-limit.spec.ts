import { test, expect } from '@playwright/test';

/**
 * OTP rate-limit smoke.
 *
 * The OTP route enforces a 45-second resend cooldown per phone (see
 * `RESEND_COOLDOWN_MS` in src/server/otp.ts). We hit it twice back-to-back
 * with the same phone and expect:
 *   - first call:  200 + { ok: true, devCode }
 *   - second call: 429 + { retryAfter: <seconds> }
 *
 * We use a never-seeded phone so other specs aren't disturbed. The OtpAttempt
 * tracker keys on `${phone}:${purpose}` so a fresh number means a clean slate.
 */
test.describe('OTP rate limit', () => {
  test('second OTP request within 30s returns 429 with retryAfter', async ({ request }) => {
    // Stamp into the phone so successive runs don't trip the per-phone
    // hourly cap. We still hit the resend cooldown because both requests
    // share the same phone string.
    const phone = '+91999' + String(Date.now()).slice(-7);

    const first = await request.post('/api/auth/otp', { data: { phone } });
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()) as { ok?: boolean; devCode?: string };
    expect(firstBody.ok).toBeTruthy();
    expect(firstBody.devCode).toBeTruthy();

    // Immediate second request — well within the 45s cooldown.
    const second = await request.post('/api/auth/otp', { data: { phone } });
    expect(second.status()).toBe(429);
    const body = (await second.json()) as { error?: string; retryAfter?: number };
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.retryAfter).toBeLessThanOrEqual(45);
  });
});
