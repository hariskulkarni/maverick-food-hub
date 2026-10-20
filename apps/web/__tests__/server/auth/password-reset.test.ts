/**
 * Password reset service: no enumeration, hashed single-use expiring token,
 * sessions revoked, staff TOTP cleared, raw token never persisted/audited.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const { db, audit, emailSend, recordLoginSuccess } = vi.hoisted(() => {
const db: any = {
  user: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  passwordResetToken: {
    create: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  userSession: { updateMany: vi.fn(async () => ({ count: 2 })) },
};
db.$transaction = vi.fn(async (cb: any) => cb(db));

const audit = vi.fn(async () => {});
const emailSend = vi.fn(async () => ({ ok: true }));
const recordLoginSuccess = vi.fn();

  return { db, audit, emailSend, recordLoginSuccess };
});

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: (...a: any[]) => (audit as any)(...a) }));
vi.mock('@/server/notifications', () => ({ notify: { email: (...a: any[]) => (emailSend as any)(...a) } }));
vi.mock('@/server/2fa', () => ({ recordLoginSuccess: (...a: any[]) => recordLoginSuccess(...a) }));
vi.mock('argon2', () => ({ default: { hash: vi.fn(async (p: string) => `hashed:${p}`) } }));

import { requestPasswordReset, consumePasswordReset } from '@/server/auth/password-reset';

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
  db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
});

describe('requestPasswordReset', () => {
  it('unknown email: no token, no email, no throw', async () => {
    db.user.findUnique.mockResolvedValue(null);
    await expect(requestPasswordReset('nobody@x.com', '1.2.3.4')).resolves.toBeUndefined();
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('soft-deleted user: silent no-op (no token, no email)', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.com', passwordHash: 'h', role: 'ADMIN', deletedAt: new Date() });
    await requestPasswordReset('a@x.com');
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('user without passwordHash (OTP-only): silent no-op', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.com', passwordHash: null, role: 'CUSTOMER' });
    await requestPasswordReset('a@x.com');
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('known credential user: invalidates prior tokens, stores hash only, emails link', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.com', passwordHash: 'h', role: 'ADMIN' });
    await requestPasswordReset('  A@X.com ', '9.9.9.9');
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@x.com' } });
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', usedAt: null } }),
    );
    expect(db.passwordResetToken.create).toHaveBeenCalledTimes(1);
    const data = (db.passwordResetToken.create.mock.calls[0] as any)[0].data;
    expect(data.userId).toBe('u1');
    expect(data.requestedIp).toBe('9.9.9.9');
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = data.expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);

    expect(emailSend).toHaveBeenCalledTimes(1);
    const mail = (emailSend.mock.calls[0] as any)[0];
    expect(mail.to).toBe('a@x.com');
    expect(mail.subject).toBe('Reset your Flavrly password');
    const m = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail.body);
    expect(m).toBeTruthy();
    const raw = m![1];
    expect(sha(raw)).toBe(data.tokenHash);
    // raw token never stored
    expect(JSON.stringify(data)).not.toContain(raw);
    expect(mail.body).toContain('30 minutes');
    expect(mail.html).toContain(raw);
  });

  it('email send failure/throw does not throw', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@x.com', passwordHash: 'h', role: 'CUSTOMER' });
    emailSend.mockRejectedValueOnce(new Error('smtp down'));
    await expect(requestPasswordReset('a@x.com')).resolves.toBeUndefined();
    expect(db.passwordResetToken.create).toHaveBeenCalled();
  });
});

function row(over: any = {}, userOver: any = {}) {
  return {
    id: 't1', userId: 'u1', tokenHash: 'x', usedAt: null,
    expiresAt: new Date(Date.now() + 10 * 60_000),
    user: { id: 'u1', email: 'a@x.com', role: 'CUSTOMER', passwordHash: 'old', ...userOver },
    ...over,
  };
}

describe('consumePasswordReset', () => {
  const RAW = 'raw-token-abc';

  it('valid token (customer): password changed, token used, sessions revoked, totp untouched', async () => {
    db.passwordResetToken.findFirst.mockResolvedValue(row());
    const r = await consumePasswordReset(RAW, 'a-long-password-1');
    expect(r).toEqual({ ok: true, staffReenroll: false });
    const q = (db.passwordResetToken.findFirst.mock.calls[0] as any)[0];
    expect(q.where.tokenHash).toBe(sha(RAW));
    expect(q.where.usedAt).toBeNull();
    const upd = (db.user.update.mock.calls[0] as any)[0];
    expect(upd.where).toEqual({ id: 'u1' });
    expect(upd.data.passwordHash).toBe('hashed:a-long-password-1');
    expect(upd.data.currentSessionId).toBeNull();
    expect(upd.data).not.toHaveProperty('totpSecret');
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(db.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date), revokedReason: 'password_reset' },
    });
    expect(recordLoginSuccess).toHaveBeenCalledWith('a@x.com');
  });

  it.each(['ADMIN', 'SUPER_ADMIN', 'KITCHEN'])('staff role %s: totp cleared and staffReenroll true', async (role) => {
    db.passwordResetToken.findFirst.mockResolvedValue(row({}, { role }));
    const r = await consumePasswordReset(RAW, 'a-long-password-1');
    expect(r).toEqual({ ok: true, staffReenroll: true });
    const upd = (db.user.update.mock.calls[0] as any)[0];
    expect(upd.data.totpSecret).toBeNull();
    expect(upd.data.totpPendingSecret).toBeNull();
    expect(upd.data.totpEnabledAt).toBeNull();
  });

  it('expired token: reason expired, nothing changed', async () => {
    db.passwordResetToken.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row({ expiresAt: new Date(Date.now() - 1000) }));
    const r = await consumePasswordReset(RAW, 'a-long-password-1');
    expect(r).toEqual({ ok: false, reason: 'expired' });
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('used token: invalid', async () => {
    db.passwordResetToken.findFirst.mockResolvedValue(null);
    const r = await consumePasswordReset(RAW, 'a-long-password-1');
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('unknown token: invalid', async () => {
    db.passwordResetToken.findFirst.mockResolvedValue(null);
    expect(await consumePasswordReset('nope', 'a-long-password-1')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('weak password: weak, nothing looked up or changed', async () => {
    const r = await consumePasswordReset(RAW, 'short');
    expect(r).toEqual({ ok: false, reason: 'weak' });
    expect(db.passwordResetToken.findFirst).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.passwordResetToken.updateMany).not.toHaveBeenCalled();
  });

  it('single-use race: token claim must be conditional on usedAt null', async () => {
    db.passwordResetToken.findFirst.mockResolvedValue(row());
    db.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 }); // lost the race
    const r = await consumePasswordReset(RAW, 'a-long-password-1');
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('raw token never appears in audit payloads', async () => {
    db.passwordResetToken.findFirst.mockResolvedValue(row({}, { role: 'ADMIN' }));
    await consumePasswordReset(RAW, 'a-long-password-1');
    expect(audit).toHaveBeenCalled();
    expect((audit.mock.calls[0] as any)[0]).toBe('auth.password.reset');
    expect(JSON.stringify(audit.mock.calls)).not.toContain(RAW);
  });
});

describe('consumePasswordReset: soft-deleted user', () => {
  it('returns invalid and changes nothing', async () => {
    db.passwordResetToken.findFirst.mockResolvedValue({
      id: 't1', userId: 'u1', user: { id: 'u1', role: 'ADMIN', email: 'a@x.com', deletedAt: new Date() },
    });
    const r = await consumePasswordReset('rawtok', 'long-enough-pw');
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
