/**
 * C9 — the DB-backed OTP mode must obey the same real-provider guard as the env
 * flag. With a real SMS provider configured, getOtpMode() must never return
 * 'demo' even if the DB says so, and setOtpMode('demo') must be refused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let dbOtpMode: string | undefined = 'demo';

vi.mock('@/server/2fa', () => ({
  getPlatformSecurity: async () => ({ otpMode: dbOtpMode }),
  setPlatformSecurity: async () => {}
}));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/server/db', () => ({ prisma: {} }));
vi.mock('@/server/notifications', () => ({ notify: {}, sendMock: async () => ({ ok: true }) }));

beforeEach(() => {
  vi.resetModules();
  dbOtpMode = 'demo';
  vi.stubEnv('NOTIFIER_SMS', 'msg91'); // real provider configured
  vi.stubEnv('OTP_DEMO_MODE', '');
});

describe('C9: DB otpMode obeys the real-provider guard', () => {
  it('getOtpMode forces production when a real provider is configured, ignoring DB demo', async () => {
    const otp = await import('@/server/otp');
    expect(otp.realOtpDeliveryConfigured()).toBe(true);
    expect(await otp.getOtpMode()).toBe('production');
  });

  it('setOtpMode(demo) throws when a real provider is configured', async () => {
    const otp = await import('@/server/otp');
    await expect(otp.setOtpMode('demo')).rejects.toThrow(/demo mode/i);
  });

  it('getOtpMode honours DB demo when no real provider is configured', async () => {
    vi.stubEnv('NOTIFIER_SMS', 'mock');
    const otp = await import('@/server/otp');
    expect(otp.realOtpDeliveryConfigured()).toBe(false);
    expect(await otp.getOtpMode()).toBe('demo');
  });
});
