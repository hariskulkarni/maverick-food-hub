import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────
// `vi.mock` factories are hoisted above imports — share refs through vi.hoisted.
const { prismaMock, argon2Mock } = vi.hoisted(() => {
  return {
    prismaMock: {
      otpAttempt: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        aggregate: vi.fn()
      },
      otpToken: {
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn()
      },
      $transaction: vi.fn(async (ops: any[]) => Promise.all(ops))
    },
    argon2Mock: {
      hash: vi.fn().mockResolvedValue('hashed'),
      verify: vi.fn().mockResolvedValue(false)
    }
  };
});

vi.mock('@/server/db', () => ({ prisma: prismaMock }));
vi.mock('@/server/notifications', () => ({ notify: { sms: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// argon2 hashing is slow and isn't what we're testing here
vi.mock('argon2', () => ({ default: argon2Mock }));

import { sendOtp, verifyOtp, OtpRateLimitedError } from '@/server/otp';

const PHONE = '+919999999999';

function freshTracker(over: any = {}) {
  return {
    id: `${PHONE}:LOGIN`,
    phone: PHONE,
    purpose: 'LOGIN',
    ipAddress: null,
    sentCount: 0,
    attempts: 0,
    lockedUntil: null,
    createdAt: new Date(),
    ...over
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.otpAttempt.upsert.mockResolvedValue(freshTracker());
  prismaMock.otpAttempt.findUnique.mockResolvedValue(freshTracker());
  prismaMock.otpAttempt.update.mockResolvedValue(freshTracker());
  prismaMock.otpAttempt.aggregate.mockResolvedValue({ _sum: { sentCount: 0 } });
  prismaMock.otpToken.findFirst.mockResolvedValue(null);
  prismaMock.otpToken.count.mockResolvedValue(0);
  prismaMock.otpToken.create.mockResolvedValue({ id: 'tok' });
  prismaMock.otpToken.update.mockResolvedValue({});
  prismaMock.otpToken.updateMany.mockResolvedValue({ count: 0 });
});

describe('sendOtp — resend cooldown', () => {
  it('throws OtpRateLimitedError when a recent OTP exists within 45s', async () => {
    prismaMock.otpToken.findFirst.mockResolvedValueOnce({
      id: 'recent',
      phone: PHONE,
      createdAt: new Date(Date.now() - 5_000) // 5s ago, cooldown is 45s
    });
    await expect(sendOtp({ phone: PHONE })).rejects.toBeInstanceOf(OtpRateLimitedError);
  });
});

describe('sendOtp — per-phone window limits', () => {
  it('throws after 3 OTPs in the last hour', async () => {
    // findFirst returns null so cooldown passes.
    // First count() call = last hour; return 3.
    prismaMock.otpToken.count.mockResolvedValueOnce(3); // hourly
    await expect(sendOtp({ phone: PHONE })).rejects.toThrow(OtpRateLimitedError);
  });

  it('throws after 8 OTPs in the last day', async () => {
    // hourly returns 0, daily returns 8.
    prismaMock.otpToken.count
      .mockResolvedValueOnce(0)  // last hour
      .mockResolvedValueOnce(8); // last day
    await expect(sendOtp({ phone: PHONE })).rejects.toThrow(OtpRateLimitedError);
  });
});

describe('sendOtp — purpose normalization', () => {
  it("normalizes 'login' to the LOGIN enum on the OtpAttempt tracker id", async () => {
    await sendOtp({ phone: PHONE, purpose: 'login' });
    const upsertArgs = prismaMock.otpAttempt.upsert.mock.calls[0][0];
    expect(upsertArgs.where.id).toBe(`${PHONE}:LOGIN`);
    expect(upsertArgs.create.purpose).toBe('LOGIN');
  });

  it("normalizes 'LOGIN' to the LOGIN enum on the OtpAttempt tracker id", async () => {
    await sendOtp({ phone: PHONE, purpose: 'LOGIN' });
    const upsertArgs = prismaMock.otpAttempt.upsert.mock.calls[0][0];
    expect(upsertArgs.where.id).toBe(`${PHONE}:LOGIN`);
  });

  it("normalizes 'phone_verify' to PHONE_VERIFY", async () => {
    await sendOtp({ phone: PHONE, purpose: 'phone_verify' });
    const upsertArgs = prismaMock.otpAttempt.upsert.mock.calls[0][0];
    expect(upsertArgs.where.id).toBe(`${PHONE}:PHONE_VERIFY`);
  });
});

describe('verifyOtp — lockout after repeated failures', () => {
  it('locks the tracker after the 5th consecutive failed verification', async () => {
    // Tracker has 4 prior failures; this 5th wrong code should trigger lockout.
    prismaMock.otpAttempt.findUnique.mockResolvedValueOnce(freshTracker({ attempts: 4 }));
    prismaMock.otpToken.findFirst.mockResolvedValueOnce({
      id: 'tok',
      phone: PHONE,
      codeHash: 'hashed',
      attempts: 0,
      expiresAt: new Date(Date.now() + 60_000)
    });
    argon2Mock.verify.mockResolvedValueOnce(false);

    const ok = await verifyOtp({ phone: PHONE, code: '999999' });
    expect(ok).toBe(false);

    // The lockedUntil should have been written on the otpAttempt update.
    const updates = prismaMock.otpAttempt.update.mock.calls.map((c: any[]) => c[0]);
    const wrote = updates.find((u: any) => u.data && u.data.lockedUntil);
    expect(wrote).toBeTruthy();
    expect(wrote.data.attempts).toBe(5);
  });
});
