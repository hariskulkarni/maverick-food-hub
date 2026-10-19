/**
 * H6 — NotificationLog must not persist a live OTP code (body + meta.otpCode
 * redacted for otp-template sends; non-OTP bodies stored verbatim).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let logged: any = null;

vi.mock('@/server/db', () => ({ prisma: { notificationLog: { create: async ({ data }: any) => { logged = data; return {}; } } } }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/server/integrations', () => ({ getConfig: async () => null, getConfigInherited: async () => null }));

import { notify } from '@/server/notifications';

beforeEach(() => { logged = null; });

describe('H6: OTP redaction in NotificationLog', () => {
  it('redacts the code from body and strips meta.otpCode for otp templates', async () => {
    await notify.sms({ to: '+9199', body: 'Your verification code is 123456. It expires in 5 minutes.', template: 'otp.login', meta: { otpCode: '123456' } });
    expect(logged.body).not.toContain('123456');
    expect(logged.body).toContain('••••');
    expect(logged.meta?.otpCode).toBeUndefined();
  });

  it('stores a non-OTP body verbatim', async () => {
    await notify.sms({ to: '+9199', body: 'Your order ORD-1 is out for delivery.', template: 'order.ofd' });
    expect(logged.body).toBe('Your order ORD-1 is out for delivery.');
  });
});
