/**
 * In-app password reset (no email): SUPER_ADMIN reset + self-service change.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, audit, authMock, argon } = vi.hoisted(() => {
  const db: any = {
    user: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    userSession: { updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  db.$transaction = vi.fn(async (cb: any) => cb(db));
  return {
    db,
    audit: vi.fn(async () => {}),
    authMock: vi.fn(),
    argon: { hash: vi.fn(async (p: string) => `hashed:${p}`), verify: vi.fn() },
  };
});

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: (...a: any[]) => (audit as any)(...a) }));
vi.mock('@/server/auth', () => ({ auth: () => authMock() }));
vi.mock('argon2', () => ({ default: argon }));
vi.mock('@/server/2fa', () => ({ recordLoginSuccess: vi.fn() }));

import { POST as adminReset } from '@/app/api/platform/users/[id]/reset-password/route';
import { POST as changePw } from '@/app/api/account/change-password/route';

const PW = 'correct-horse-battery';
const req = (body: unknown) =>
  new Request('http://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as any;
const ctx = (id = 'u1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (cb: any) => cb(db));
});

describe('POST /api/platform/users/[id]/reset-password', () => {
  it('non-super-admin -> 403, nothing changed', async () => {
    authMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN' } });
    const r = await adminReset(req({ password: PW }), ctx());
    expect(r.status).toBe(403);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('unauthenticated -> 401', async () => {
    authMock.mockResolvedValue(null);
    expect((await adminReset(req({ password: PW }), ctx())).status).toBe(401);
  });

  it('weak password -> 400, nothing changed', async () => {
    authMock.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    const r = await adminReset(req({ password: 'short' }), ctx());
    expect(r.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // TOTP is now its own super-admin action (reset-totp); a password reset keeps
  // it and forces a password change at next login instead.
  it('staff target: sets hash, revokes all sessions, forces change, keeps TOTP, audits without password', async () => {
    authMock.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    db.user.findUnique.mockResolvedValue({ id: 'u1', role: 'KITCHEN', deletedAt: null });
    const r = await adminReset(req({ password: PW }), ctx());
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toEqual({ ok: true, staffReenroll: false });
    const data = db.user.update.mock.calls[0][0].data;
    expect(data.passwordHash).toBe(`hashed:${PW}`);
    expect(data.currentSessionId).toBeNull();
    expect(data.mustChangePassword).toBe(true);
    expect(data).not.toHaveProperty('totpSecret');
    expect(db.userSession.updateMany.mock.calls[0][0]).toMatchObject({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedReason: 'admin_password_reset' },
    });
    expect((audit.mock.calls as any[])[0][0]).toBe('platform.user.password.reset');
    expect(JSON.stringify(audit.mock.calls)).not.toContain(PW);
    expect(JSON.stringify(audit.mock.calls)).not.toContain('hashed:');
    expect(JSON.stringify(body)).not.toContain(PW);
  });

  it('customer target: does not touch TOTP, staffReenroll false', async () => {
    authMock.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    db.user.findUnique.mockResolvedValue({ id: 'u2', role: 'CUSTOMER', deletedAt: null });
    const r = await adminReset(req({ password: PW }), ctx('u2'));
    expect(await r.json()).toEqual({ ok: true, staffReenroll: false });
    expect(db.user.update.mock.calls[0][0].data).not.toHaveProperty('totpSecret');
  });

  it('unknown user -> 404', async () => {
    authMock.mockResolvedValue({ user: { id: 'sa', role: 'SUPER_ADMIN' } });
    db.user.findUnique.mockResolvedValue(null);
    expect((await adminReset(req({ password: PW }), ctx('zz'))).status).toBe(404);
  });
});

describe('POST /api/account/change-password', () => {
  const NEW = 'brand-new-passphrase';
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'CUSTOMER' } });
    db.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: 'oldhash', currentSessionId: 'sess-cur', deletedAt: null });
  });

  it('unauthenticated -> 401', async () => {
    authMock.mockResolvedValue(null);
    expect((await changePw(req({ currentPassword: 'x', newPassword: NEW }))).status).toBe(401);
  });

  it('wrong current password -> 400 invalid_current, no change', async () => {
    argon.verify.mockResolvedValue(false);
    const r = await changePw(req({ currentPassword: 'wrong-password-1', newPassword: NEW }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('invalid_current');
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('weak new password -> 400, no change', async () => {
    const r = await changePw(req({ currentPassword: 'old-password-123', newPassword: 'short' }));
    expect(r.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('correct -> updates hash, keeps current session, revokes others, no password in audit/response', async () => {
    argon.verify.mockResolvedValue(true);
    const r = await changePw(req({ currentPassword: 'old-password-123', newPassword: NEW }));
    expect(r.status).toBe(200);
    const text = JSON.stringify(await r.json());
    expect(text).not.toContain(NEW);
    expect(db.user.update.mock.calls[0][0].data).toEqual({ passwordHash: `hashed:${NEW}`, mustChangePassword: false });
    const rev = db.userSession.updateMany.mock.calls[0][0];
    expect(rev.where).toMatchObject({ userId: 'u1', revokedAt: null, id: { not: 'sess-cur' } });
    expect(rev.data.revokedReason).toBe('password_changed');
    expect((audit.mock.calls as any[])[0][0]).toBe('account.password.change');
    const a = JSON.stringify(audit.mock.calls);
    expect(a).not.toContain(NEW);
    expect(a).not.toContain('old-password-123');
    expect(a).not.toContain('hashed:');
  });

  it('account without password hash -> 400 invalid_current', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'u1', passwordHash: null, currentSessionId: null, deletedAt: null });
    const r = await changePw(req({ currentPassword: 'old-password-123', newPassword: NEW }));
    expect(r.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
