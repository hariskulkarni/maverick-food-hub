/**
 * No-stuck login paths:
 *  - a super-admin issued password (mustChangePassword) must be replaced
 *    before any session: precheck asks for it, /api/auth/staff/change-password
 *    sets it, and the email-password provider refuses to sign in meanwhile;
 *  - a locked-out email is told how long to wait instead of "invalid".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, verify, hash, start, sec, auditFn } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn() } },
  verify: vi.fn(async () => true),
  hash: vi.fn(async (p: string) => `hashed:${p}`),
  start: vi.fn(async () => ({ qr: 'q', secret: 's', otpauth: 'o' })),
  sec: {
    isLockedOut: vi.fn(() => false),
    lockoutRemainingMs: vi.fn(() => 0),
    recordLoginFailure: vi.fn(),
    recordLoginSuccess: vi.fn(),
    getPlatformSecurity: vi.fn(async () => ({ lockoutMinutes: 15 })),
    ipMatchesAllowlist: () => true,
  },
  auditFn: vi.fn(async (..._a: any[]) => {}),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('argon2', () => ({ default: { verify, hash } }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 1 }) }));
vi.mock('@/server/2fa', () => sec);
vi.mock('@/server/audit', () => ({ audit: auditFn }));
vi.mock('@/server/user-totp', async (orig) => ({
  ...(await orig<typeof import('@/server/user-totp')>()),
  startEnrollment: start,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock('next-auth/providers/credentials', () => ({ default: (c: unknown) => c }));
vi.mock('next-auth/providers/google', () => ({ default: (c: unknown) => c }));
vi.mock('@/server/auth.config', () => ({ authEdgeConfig: {} }));

import { POST as precheck } from '@/app/api/auth/staff/precheck/route';
import { POST as changePassword } from '@/app/api/auth/staff/change-password/route';
import { authConfig } from '@/server/auth';

const mk = (body: unknown) =>
  new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const user = (over: any = {}) => ({
  id: 'u1', email: 'a@x.com', passwordHash: 'h', role: 'KITCHEN', name: null,
  suspendedAt: null, deletedAt: null, totpEnabledAt: new Date(), totpSecret: null, mustChangePassword: true, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  verify.mockResolvedValue(true);
  sec.isLockedOut.mockReturnValue(false);
  sec.lockoutRemainingMs.mockReturnValue(0);
});

describe('precheck', () => {
  it('asks for a new password when mustChangePassword is set (no enrolment yet)', async () => {
    db.user.findUnique.mockResolvedValue(user());
    expect(await (await precheck(mk({ email: 'a@x.com', password: 'temp' }))).json()).toEqual({ ok: true, status: 'change_password' });
    expect(start).not.toHaveBeenCalled();
  });
  it('locked out -> tells the user how long to wait', async () => {
    sec.isLockedOut.mockReturnValue(true);
    sec.lockoutRemainingMs.mockReturnValue(7 * 60_000 + 1);
    const j = await (await precheck(mk({ email: 'a@x.com', password: 'p' }))).json();
    expect(j).toEqual({ ok: false, locked: true, retryAfterSeconds: 421 });
  });
});

describe('POST /api/auth/staff/change-password', () => {
  const NEW = 'a-brand-new-password';
  it('replaces the temp password, clears the flag, audits without secrets', async () => {
    db.user.findUnique.mockResolvedValue(user());
    db.user.updateMany.mockResolvedValue({ count: 1 });
    const r = await changePassword(mk({ email: 'a@x.com', password: 'TEMP-PASS-WORD-1234', newPassword: NEW }));
    expect(await r.json()).toEqual({ ok: true });
    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', mustChangePassword: true },
      data: { passwordHash: `hashed:${NEW}`, mustChangePassword: false },
    });
    expect(JSON.stringify(auditFn.mock.calls)).not.toContain(NEW);
    expect(sec.recordLoginSuccess).toHaveBeenCalledWith('a@x.com');
  });
  it('wrong temp password -> ok:false and a recorded failure', async () => {
    verify.mockResolvedValue(false);
    db.user.findUnique.mockResolvedValue(user());
    expect(await (await changePassword(mk({ email: 'a@x.com', password: 'bad', newPassword: NEW }))).json()).toEqual({ ok: false });
    expect(sec.recordLoginFailure).toHaveBeenCalled();
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it('refused when no change is pending (not a TOTP bypass)', async () => {
    db.user.findUnique.mockResolvedValue(user({ mustChangePassword: false }));
    expect(await (await changePassword(mk({ email: 'a@x.com', password: 'p', newPassword: NEW }))).json()).toEqual({ ok: false });
    expect(db.user.updateMany).not.toHaveBeenCalled();
  });
  it('weak or unchanged new password -> 400', async () => {
    db.user.findUnique.mockResolvedValue(user());
    expect((await changePassword(mk({ email: 'a@x.com', password: 'p', newPassword: 'short' }))).status).toBe(400);
    expect((await changePassword(mk({ email: 'a@x.com', password: NEW, newPassword: NEW }))).status).toBe(400);
  });
  it('locked out -> ok:false with retryAfterSeconds, password not checked', async () => {
    sec.isLockedOut.mockReturnValue(true);
    sec.lockoutRemainingMs.mockReturnValue(60_000);
    const j = await (await changePassword(mk({ email: 'a@x.com', password: 'p', newPassword: NEW }))).json();
    expect(j).toMatchObject({ ok: false, locked: true });
    expect(verify).not.toHaveBeenCalled();
  });
});

describe('email-password provider', () => {
  it('refuses a session while mustChangePassword is set', async () => {
    const provider: any = (authConfig.providers as any[]).find((p) => p.id === 'email-password');
    db.user.findUnique.mockResolvedValue(user());
    expect(await provider.authorize({ email: 'a@x.com', password: 'temp', totp: '123456' }, { headers: new Headers() })).toBeNull();
    expect(auditFn).toHaveBeenCalledWith('auth.login.failed', expect.objectContaining({ after: { reason: 'must_change_password' } }));
  });
});

describe('precheck: blocked accounts', () => {
  it('suspended + correct password -> clear suspended message', async () => {
    db.user.findUnique.mockResolvedValue(user({ suspendedAt: new Date(), mustChangePassword: false }));
    expect(await (await precheck(mk({ email: 'a@x.com', password: 'p' }))).json()).toMatchObject({ ok: false, suspended: true });
  });
  it('suspended + wrong password -> generic invalid (no account-state leak)', async () => {
    verify.mockResolvedValue(false);
    db.user.findUnique.mockResolvedValue(user({ suspendedAt: new Date() }));
    expect(await (await precheck(mk({ email: 'a@x.com', password: 'bad' }))).json()).toEqual({ ok: false });
  });
});
