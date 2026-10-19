/**
 * H20 — purpose is canonicalized before every cooldown/count query, so rotating
 * the free-form string can't mint a fresh counter bucket.
 * H21 — a successful send must NOT reset the failed-verify counter (attempts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    otpAttempt: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    otpToken: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn()
  } as any
}));

vi.mock('@/server/db', () => ({ prisma: prismaMock }));
vi.mock('argon2', () => ({ default: { hash: vi.fn().mockResolvedValue('h'), verify: vi.fn() } }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn().mockResolvedValue({ ok: true }), whatsapp: vi.fn().mockResolvedValue({ ok: true }) } }));
vi.mock('@/server/2fa', () => ({ getPlatformSecurity: vi.fn().mockResolvedValue({}), setPlatformSecurity: vi.fn() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendOtp } from '@/server/otp';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.otpAttempt.upsert.mockResolvedValue({ id: 't', lockedUntil: null, attempts: 2, ipAddress: null });
  prismaMock.otpAttempt.update.mockResolvedValue({});
  prismaMock.otpToken.findFirst.mockResolvedValue(null);
  prismaMock.otpToken.count.mockResolvedValue(0);
  prismaMock.otpToken.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.otpAttempt.aggregate.mockResolvedValue({ _sum: { sentCount: 0 } });
  prismaMock.$transaction.mockResolvedValue([{}, {}]);
});

describe('H20: purpose is canonicalized for counting', () => {
  it("counts an uppercase 'LOGIN' under the same bucket as 'login'", async () => {
    await sendOtp({ phone: '+9199', purpose: 'LOGIN' });
    const countWheres = prismaMock.otpToken.count.mock.calls.map((c: any) => c[0]?.where?.purpose);
    // every per-phone count query keyed on the canonical 'login', not 'LOGIN'
    expect(countWheres.filter((p: any) => p !== undefined).every((p: any) => p === 'login')).toBe(true);
  });

  it("stores the token under the canonical purpose for an arbitrary variant", async () => {
    await sendOtp({ phone: '+9199', purpose: 'login-xyz-bypass' });
    const created = prismaMock.otpToken.create.mock.calls[0][0].data;
    expect(created.purpose).toBe('login');
  });
});

describe('H21: send does not reset the failed-verify counter', () => {
  it('omits `attempts` from the otpAttempt send update', async () => {
    await sendOtp({ phone: '+9199', purpose: 'login' });
    const updateData = prismaMock.otpAttempt.update.mock.calls[0][0].data;
    expect(updateData).not.toHaveProperty('attempts');
    expect(updateData.sentCount).toEqual({ increment: 1 });
  });
});
