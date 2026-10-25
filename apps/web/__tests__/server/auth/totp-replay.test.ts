/**
 * F15 — a Google Authenticator code is single-use: once a login consumed the
 * code for a 30s step, the same (or an older) step is refused, even inside the
 * ±1 step clock-skew window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticator } from 'otplib';

const { db } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() } },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/crypto', () => ({
  encryptJSON: (v: unknown) => JSON.stringify(v),
  decryptJSON: (b: string) => JSON.parse(b),
}));
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock('next-auth/providers/credentials', () => ({ default: (c: unknown) => c }));
vi.mock('next-auth/providers/google', () => ({ default: (c: unknown) => c }));
vi.mock('@/server/auth.config', () => ({ authEdgeConfig: {} }));
vi.mock('argon2', () => ({ default: { verify: vi.fn(async () => true), hash: vi.fn() } }));
vi.mock('@/server/2fa', () => ({
  getPlatformSecurity: vi.fn(async () => ({})),
  ipMatchesAllowlist: () => true,
  isLockedOut: () => false,
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
}));

import { consumeUserTotp } from '@/server/user-totp';
import { authConfig } from '@/server/auth';

const SECRET = 'JBSWY3DPEHPK3PXP';
const T0 = Date.UTC(2026, 0, 1, 12, 0, 15);
const STEP0 = Math.floor(T0 / 30_000);

let row: { id: string; totpLastStep: number | null };
function codeAt(ms: number) {
  vi.setSystemTime(ms);
  const c = authenticator.generate(SECRET);
  vi.setSystemTime(T0);
  return c;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.clearAllMocks();
  row = { id: 'u1', totpLastStep: null };
  // Emulates `updateMany where { id, OR:[{totpLastStep:null},{totpLastStep:{lt}}] }`.
  db.user.updateMany.mockImplementation(async ({ where, data }: any) => {
    const lt = where.OR?.find((c: any) => c.totpLastStep?.lt !== undefined)?.totpLastStep.lt;
    const ok = where.id === row.id && (row.totpLastStep === null || row.totpLastStep < lt);
    if (ok) row.totpLastStep = data.totpLastStep;
    return { count: ok ? 1 : 0 };
  });
});
afterEach(() => { vi.useRealTimers(); });

const user = { id: 'u1', totpSecret: JSON.stringify({ s: SECRET }) };

describe('F15: consumeUserTotp', () => {
  it('accepts a fresh code and records its step', async () => {
    expect(await consumeUserTotp(user, codeAt(T0))).toBe(true);
    expect(row.totpLastStep).toBe(STEP0);
  });
  it('rejects replay of the same code', async () => {
    const c = codeAt(T0);
    expect(await consumeUserTotp(user, c)).toBe(true);
    expect(await consumeUserTotp(user, c)).toBe(false);
  });
  it('rejects an older (previous-step) code after a newer one was used', async () => {
    expect(await consumeUserTotp(user, codeAt(T0))).toBe(true);
    expect(await consumeUserTotp(user, codeAt(T0 - 30_000))).toBe(false);
  });
  it('accepts the next step after the current one', async () => {
    expect(await consumeUserTotp(user, codeAt(T0))).toBe(true);
    expect(await consumeUserTotp(user, codeAt(T0 + 30_000))).toBe(true);
  });
  it('rejects a wrong code without touching the row', async () => {
    expect(await consumeUserTotp(user, '000000')).toBe(false);
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('F15: email-password login refuses a replayed code', () => {
  it('second login with the same code is refused', async () => {
    const provider: any = (authConfig.providers as any[]).find((p) => p.id === 'email-password');
    db.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'a@x.com', role: 'ADMIN', passwordHash: 'h', name: null,
      suspendedAt: null, deletedAt: null, totpEnabledAt: new Date(), totpSecret: user.totpSecret,
    });
    const code = codeAt(T0);
    const creds = { email: 'a@x.com', password: 'pw', totp: code };
    expect(await provider.authorize(creds, { headers: new Headers() })).toMatchObject({ id: 'u1' });
    expect(await provider.authorize(creds, { headers: new Headers() })).toBeNull();
  });
});
