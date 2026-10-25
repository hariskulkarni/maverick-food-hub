/**
 * /api/auth/otp/test-account (MSG91-widget login path): issues a code only for an
 * active pre-launch test account; for any other number it issues nothing and the
 * reply does not reveal whether the number has an account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  sendOtp: vi.fn(async () => ({ ok: true, devCode: '123456' })),
  findActiveTestAccount: vi.fn(),
}));
vi.mock('@/server/otp', () => ({ sendOtp: h.sendOtp, OtpRateLimitedError: class extends Error {} }));
vi.mock('@/server/test-accounts', () => ({ findActiveTestAccount: h.findActiveTestAccount }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }));

import { POST } from '@/app/api/auth/otp/test-account/route';

const call = (phone: string) =>
  POST(new Request('http://x/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone }),
  }) as any);

beforeEach(() => vi.clearAllMocks());

describe('POST /api/auth/otp/test-account', () => {
  it('returns { testAccount: false } and issues nothing for an ordinary number', async () => {
    h.findActiveTestAccount.mockResolvedValue(null);
    const res = await call('+919876500002');
    expect(await res.json()).toEqual({ testAccount: false });
    expect(h.sendOtp).not.toHaveBeenCalled();
  });

  it('issues a login code for an active test account and returns it for the screen', async () => {
    h.findActiveTestAccount.mockResolvedValue({ id: 'test-user' });
    const res = await call('+919876500001');
    expect(await res.json()).toEqual({ testAccount: true, ok: true, devCode: '123456' });
    expect(h.sendOtp).toHaveBeenCalledWith(expect.objectContaining({ phone: '+919876500001', purpose: 'login' }));
  });
});
