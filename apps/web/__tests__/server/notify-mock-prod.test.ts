/**
 * F12 — the mock notifier must not report success in production, must never
 * log a live OTP code, and the provider env vars are read case-insensitively
 * with NOTIFIER_SMS / SMS_PROVIDER treated as one setting everywhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let logged: any = null;
const info = vi.hoisted(() => vi.fn());
vi.mock('@/server/db', () => ({ prisma: { notificationLog: { create: async ({ data }: any) => { logged = data; return {}; } } } }));
vi.mock('@/server/log', () => ({ log: { info, warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/integrations', () => ({ getConfig: async () => null, getConfigInherited: async () => null }));
const msg91 = vi.hoisted(() => vi.fn(async () => ({ ok: true, providerId: 'm1' })));
vi.mock('@/server/notifications/msg91', () => ({ sendMsg91: msg91 }));

import { notify } from '@/server/notifications';

beforeEach(() => { logged = null; vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('F12: mock notifier', () => {
  it('production with no provider -> ok:false, journaled FAILED', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NOTIFIER_SMS', '');
    vi.stubEnv('SMS_PROVIDER', '');
    const r = await notify.sms({ to: '+9199', body: 'Order ready', template: 'order.ready' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no sms provider/i);
    expect(logged.status).toBe('FAILED');
  });

  it('development keeps the mock success (control)', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NOTIFIER_SMS', '');
    const r = await notify.sms({ to: '+9199', body: 'Order ready', template: 'order.ready' });
    expect(r.ok).toBe(true);
  });

  it('mock log never contains a live OTP code', async () => {
    vi.stubEnv('NOTIFIER_SMS', '');
    await notify.sms({ to: '+9199', body: 'Your verification code is 482913. It expires in 5 minutes.', template: 'otp.login', meta: { otpCode: '482913' } });
    const all = JSON.stringify(info.mock.calls);
    expect(all).not.toContain('482913');
  });
});

describe('F12: provider env is case-insensitive and unified', () => {
  it('NOTIFIER_SMS=MSG91 routes to MSG91', async () => {
    vi.stubEnv('NOTIFIER_SMS', 'MSG91');
    vi.stubEnv('MSG91_AUTH_KEY', 'k');
    vi.stubEnv('MSG91_SENDER_ID', 'FLVRLY');
    await notify.sms({ to: '+9199', body: 'Order ready', template: 'order.ready' });
    expect(msg91).toHaveBeenCalled();
  });

  it('otp.ts sees SMS_PROVIDER as a real provider, like the dispatcher does', async () => {
    vi.stubEnv('NOTIFIER_SMS', '');
    vi.stubEnv('SMS_PROVIDER', 'msg91');
    vi.stubEnv('OTP_DEMO_MODE', 'false');
    vi.stubEnv('OTP_DEBUG_LOG', 'false');
    vi.resetModules();
    vi.doMock('@/server/2fa', () => ({ getPlatformSecurity: async () => ({}), setPlatformSecurity: async () => {} }));
    const { realOtpDeliveryConfigured } = await import('@/server/otp');
    expect(realOtpDeliveryConfigured()).toBe(true);
  });
});
