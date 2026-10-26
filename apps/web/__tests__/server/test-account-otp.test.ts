/**
 * Pre-launch test customer accounts: in PRODUCTION with a real SMS provider, an
 * active test account gets its OTP back for the screen and nothing is sent;
 * everyone else (incl. a deleted / unflagged account) gets the normal SMS path
 * and never sees the code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  prisma: {
    otpAttempt: { upsert: vi.fn(), update: vi.fn(), aggregate: vi.fn(), findUnique: vi.fn() },
    otpToken: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    userSession: { updateMany: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  },
  sms: vi.fn(),
  whatsapp: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: h.prisma }));
vi.mock('@/server/notifications', () => ({ notify: { sms: h.sms, whatsapp: h.whatsapp } }));
vi.mock('@/server/log', () => ({ log: { info: h.logInfo, warn: vi.fn(), error: vi.fn() } }));
vi.mock('argon2', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed'), verify: vi.fn().mockResolvedValue(true) } }));
vi.mock('@/server/2fa', () => ({ getPlatformSecurity: vi.fn().mockResolvedValue({}), setPlatformSecurity: vi.fn() }));
vi.mock('@/server/audit', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

const PHONE = '+919876500001';

async function loadOtp() {
  vi.resetModules();
  return import('@/server/otp');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NOTIFIER_SMS', 'msg91');
  vi.stubEnv('OTP_DEMO_MODE', '');
  vi.stubEnv('OTP_DEBUG_LOG', '');
  h.prisma.otpAttempt.upsert.mockResolvedValue({ id: `${PHONE}:LOGIN`, lockedUntil: null, attempts: 0 });
  h.prisma.otpAttempt.update.mockResolvedValue({});
  h.prisma.otpAttempt.aggregate.mockResolvedValue({ _sum: { sentCount: 0 } });
  h.prisma.otpToken.findFirst.mockResolvedValue(null);
  h.prisma.otpToken.count.mockResolvedValue(0);
  h.prisma.otpToken.create.mockResolvedValue({ id: 'tok' });
  h.prisma.otpToken.updateMany.mockResolvedValue({ count: 0 });
  h.prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: typeof h.prisma) => unknown)(h.prisma) : Promise.all(arg as unknown[]));
  h.sms.mockResolvedValue({ ok: true });
  h.whatsapp.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('sendOtp — pre-launch test account', () => {
  it('returns the code for the screen and sends nothing for an active test account', async () => {
    h.prisma.user.findFirst.mockResolvedValue({ id: 'test-user' });
    const { sendOtp } = await loadOtp();
    const r = await sendOtp({ phone: PHONE, purpose: 'login', ipAddress: '203.0.113.9' });
    expect(r.devCode).toMatch(/^\d{6}$/);
    expect(h.sms).not.toHaveBeenCalled();
    expect(h.whatsapp).not.toHaveBeenCalled();
    // Only active, flagged customers qualify.
    expect(h.prisma.user.findFirst).toHaveBeenCalledWith({
      where: { phone: PHONE, isTestAccount: true, deletedAt: null, suspendedAt: null, role: 'CUSTOMER' },
      select: { id: true },
    });
    // The code itself is never logged.
    const logged = JSON.stringify(h.logInfo.mock.calls);
    expect(logged).not.toContain(r.devCode!);
    // Still stored hashed like any other OTP.
    expect(h.prisma.otpToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ codeHash: 'hashed', phone: PHONE }) }));
  });

  it('a deleted / unflagged number gets the normal SMS path and no on-screen code', async () => {
    h.prisma.user.findFirst.mockResolvedValue(null);
    const { sendOtp } = await loadOtp();
    const r = await sendOtp({ phone: PHONE, purpose: 'login', ipAddress: '203.0.113.9' });
    expect(r.devCode).toBeUndefined();
    expect(h.sms).toHaveBeenCalledTimes(1);
  });

  it('still applies the resend cooldown to test accounts', async () => {
    h.prisma.user.findFirst.mockResolvedValue({ id: 'test-user' });
    h.prisma.otpToken.findFirst.mockResolvedValue({ id: 'recent', createdAt: new Date(Date.now() - 5_000) });
    const { sendOtp, OtpRateLimitedError } = await loadOtp();
    await expect(sendOtp({ phone: PHONE, purpose: 'login' })).rejects.toBeInstanceOf(OtpRateLimitedError);
  });
});

describe('test-account admin helpers', () => {
  it('create: new number becomes a CUSTOMER test account in +91 form', async () => {
    h.prisma.user.findUnique.mockResolvedValue(null);
    h.prisma.user.create.mockResolvedValue({ id: 'u1' });
    const { createTestAccount } = await import('@/server/test-accounts');
    const r = await createTestAccount('98765 00001');
    expect(r).toMatchObject({ ok: true, phone: PHONE });
    expect(h.prisma.user.create).toHaveBeenCalledWith({ data: { phone: PHONE, name: 'Flavrly Test Customer', role: 'CUSTOMER', isTestAccount: true } });
  });

  it('create: refuses staff numbers and malformed input', async () => {
    const { createTestAccount } = await import('@/server/test-accounts');
    h.prisma.user.findUnique.mockResolvedValue({ id: 'a1', role: 'ADMIN', deletedAt: null });
    expect((await createTestAccount('9876500001')).ok).toBe(false);
    expect((await createTestAccount('12345')).ok).toBe(false);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
    expect(h.prisma.user.create).not.toHaveBeenCalled();
  });

  it('delete: clears the flag, soft-deletes and revokes sessions', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ id: 'u1', isTestAccount: true });
    h.prisma.userSession.create.mockResolvedValue({ id: 'marker' });
    const { deleteTestAccount } = await import('@/server/test-accounts');
    const r = await deleteTestAccount('+919876500001');
    expect(r.ok).toBe(true);
    expect(h.prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isTestAccount: false, deletedAt: expect.any(Date) } });
    expect(h.prisma.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }));
  });

  it('delete: refuses a number that is not a test account', async () => {
    h.prisma.user.findUnique.mockResolvedValue({ id: 'c1', isTestAccount: false });
    const { deleteTestAccount } = await import('@/server/test-accounts');
    expect((await deleteTestAccount('9876500001')).ok).toBe(false);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });
});
