/**
 * F5 — platform-team roles (ADMIN_ASSIST / DEVELOPER / QA / GUEST) use the same
 * password + Google Authenticator login as staff: precheck must start their
 * enrolment instead of answering "invalid credentials".
 * F6 — precheck / enroll verify the password, so they must honour the login
 * lockout (else they are a password oracle that bypasses it).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, verify, start, confirm, sec } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() } },
  verify: vi.fn(async () => true),
  start: vi.fn(async () => ({ qr: 'q', secret: 's', otpauth: 'o' })),
  confirm: vi.fn(async () => true),
  sec: {
    isLockedOut: vi.fn(() => false),
    lockoutRemainingMs: vi.fn(() => 120_000),
    recordLoginFailure: vi.fn(),
    recordLoginSuccess: vi.fn(),
    getPlatformSecurity: vi.fn(async () => ({ lockoutMinutes: 15 })),
  },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('argon2', () => ({ default: { verify } }));
vi.mock('@/server/http/rate-limit', () => ({ rateLimit: async () => ({ ok: true, remaining: 1 }) }));
vi.mock('@/server/2fa', () => sec);
vi.mock('@/server/audit', () => ({ audit: vi.fn(async () => {}) }));
vi.mock('@/server/user-totp', async (orig) => ({
  ...(await orig<typeof import('@/server/user-totp')>()),
  startEnrollment: start,
  confirmEnrollment: confirm,
}));

import { POST as precheck } from '@/app/api/auth/staff/precheck/route';
import { POST as enroll } from '@/app/api/auth/staff/enroll/route';
import { isStaffTotpRole } from '@/server/user-totp';

const mk = (body: unknown) =>
  new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any;
const user = (role: string) => ({ id: 'u1', email: 'a@x.com', passwordHash: 'h', role, suspendedAt: null, deletedAt: null, totpEnabledAt: null });

beforeEach(() => {
  vi.clearAllMocks();
  verify.mockResolvedValue(true);
  sec.isLockedOut.mockReturnValue(false);
});

describe('F5: platform-team roles go through the staff TOTP gate', () => {
  for (const role of ['ADMIN_ASSIST', 'DEVELOPER', 'QA', 'GUEST']) {
    it(`${role} is a TOTP role and precheck starts enrolment`, async () => {
      expect(isStaffTotpRole(role)).toBe(true);
      db.user.findUnique.mockResolvedValue(user(role));
      const j = await (await precheck(mk({ email: 'a@x.com', password: 'p' }))).json();
      expect(j).toMatchObject({ ok: true, status: 'enroll' });
    });
  }
  it('CUSTOMER and RIDER stay outside the gate', async () => {
    expect(isStaffTotpRole('CUSTOMER')).toBe(false);
    expect(isStaffTotpRole('RIDER')).toBe(false);
  });
});

describe('F6: precheck / enroll honour the login lockout', () => {
  it('precheck: locked-out email -> ok:false, password never checked', async () => {
    sec.isLockedOut.mockReturnValue(true);
    db.user.findUnique.mockResolvedValue(user('ADMIN'));
    expect(await (await precheck(mk({ email: 'A@x.com', password: 'p' }))).json()).toEqual({ ok: false, locked: true, retryAfterSeconds: 120 });
    expect(sec.isLockedOut).toHaveBeenCalledWith('a@x.com');
    expect(verify).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it('precheck: wrong password records a login failure', async () => {
    verify.mockResolvedValue(false);
    db.user.findUnique.mockResolvedValue(user('ADMIN'));
    expect(await (await precheck(mk({ email: 'a@x.com', password: 'bad' }))).json()).toEqual({ ok: false });
    expect(sec.recordLoginFailure).toHaveBeenCalledWith('a@x.com', 15);
  });
  it('precheck: unknown email records a login failure', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await precheck(mk({ email: 'nobody@x.com', password: 'p' }));
    expect(sec.recordLoginFailure).toHaveBeenCalledWith('nobody@x.com', 15);
  });
  it('enroll: locked-out email -> ok:false, nothing confirmed', async () => {
    sec.isLockedOut.mockReturnValue(true);
    db.user.findUnique.mockResolvedValue(user('ADMIN'));
    expect(await (await enroll(mk({ email: 'a@x.com', password: 'p', code: '123456' }))).json()).toEqual({ ok: false });
    expect(verify).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('enroll: wrong password or wrong code records a login failure', async () => {
    db.user.findUnique.mockResolvedValue(user('ADMIN'));
    verify.mockResolvedValueOnce(false);
    await enroll(mk({ email: 'a@x.com', password: 'bad', code: '123456' }));
    confirm.mockResolvedValueOnce(false);
    await enroll(mk({ email: 'a@x.com', password: 'p', code: '000000' }));
    expect(sec.recordLoginFailure).toHaveBeenCalledTimes(2);
  });
});
