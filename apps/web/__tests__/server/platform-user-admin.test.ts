/**
 * Owner requirement: SUPER_ADMIN has full recovery controls over any account
 * (temp password with forced change, TOTP reset, unlock, role change,
 * suspend/unsuspend, sign-out everywhere, activity view) — every action
 * audited without secrets, with self-lockout and last-super-admin guards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type U = Record<string, any>;
const users = new Map<string, U>();
const sessionsRevoked: string[] = [];
const { db, auditFn, sec, hash } = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    restaurant: { count: vi.fn(async () => 0) },
    restaurantUser: { updateMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn(async () => ({ count: 2 })) },
    branchUser: { updateMany: vi.fn(async () => ({ count: 1 })), deleteMany: vi.fn(async () => ({ count: 1 })) },
    userSession: { updateMany: vi.fn(), findMany: vi.fn() },
    otpAttempt: { updateMany: vi.fn() },
    auditLog: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  auditFn: vi.fn(async (..._a: any[]) => {}),
  sec: { recordLoginSuccess: vi.fn() },
  hash: vi.fn(async (p: string) => `hashed:${p}`),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: auditFn }));
vi.mock('@/server/2fa', () => sec);
vi.mock('argon2', () => ({ default: { hash } }));

import {
  adminResetPassword, adminResetTotp, adminUnlock, adminSetRole,
  adminSetSuspended, adminSignOut, getUserActivity,
} from '@/server/platform-user-admin';

const actor = { id: 'su1', role: 'SUPER_ADMIN' };
const meta = { ip: '1.2.3.4', userAgent: 'ua' };

beforeEach(() => {
  vi.clearAllMocks();
  users.clear();
  sessionsRevoked.length = 0;
  users.set('su1', { id: 'su1', role: 'SUPER_ADMIN', email: 'su1@x.com', suspendedAt: null, deletedAt: null });
  users.set('k1', { id: 'k1', role: 'KITCHEN', email: 'k1@x.com', phone: '+911', suspendedAt: null, deletedAt: null, totpEnabledAt: new Date() });
  users.set('c1', { id: 'c1', role: 'CUSTOMER', email: null, phone: '+912', suspendedAt: null, deletedAt: null });
  users.set('su2', { id: 'su2', role: 'SUPER_ADMIN', email: 'su2@x.com', suspendedAt: null, deletedAt: null });
  db.user.findUnique.mockImplementation(async ({ where }: any) => users.get(where.id) ?? null);
  db.user.update.mockImplementation(async ({ where, data }: any) => { const u = { ...users.get(where.id), ...data }; users.set(where.id, u); return u; });
  db.user.count.mockImplementation(async ({ where }: any) =>
    [...users.values()].filter((u) => u.role === where.role && !u.suspendedAt && !u.deletedAt && u.id !== where.id?.not).length);
  db.userSession.updateMany.mockImplementation(async ({ where }: any) => { sessionsRevoked.push(where.userId); return { count: 1 }; });
  db.otpAttempt.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
});

const auditJson = () => JSON.stringify(auditFn.mock.calls);

describe('adminResetPassword', () => {
  it('generates a one-time temp password, forces a change, signs out, never audits it', async () => {
    const r = await adminResetPassword(actor, 'k1', {}, meta);
    expect(r.ok).toBe(true);
    const temp = (r as any).tempPassword as string;
    expect(temp.length).toBeGreaterThanOrEqual(14);
    const u = users.get('k1')!;
    expect(u.passwordHash).toBe(`hashed:${temp}`);
    expect(u.mustChangePassword).toBe(true);
    expect(u.currentSessionId).toBeNull();
    expect(sessionsRevoked).toContain('k1');
    expect(sec.recordLoginSuccess).toHaveBeenCalledWith('k1@x.com');
    expect(auditFn).toHaveBeenCalledWith('platform.user.password.reset', expect.objectContaining({ actorId: 'su1', entityId: 'k1' }));
    expect(auditJson()).not.toContain(temp);
  });
  it('accepts an admin-chosen password (not echoed back)', async () => {
    const r = await adminResetPassword(actor, 'c1', { password: 'a-chosen-password-1' }, meta);
    expect(r).toEqual({ ok: true, generated: false });
    expect(users.get('c1')!.passwordHash).toBe('hashed:a-chosen-password-1');
  });
  it('rejects a short chosen password', async () => {
    const r = await adminResetPassword(actor, 'k1', { password: 'short' }, meta);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
  it('refuses self (use account settings)', async () => {
    expect(await adminResetPassword(actor, 'su1', {}, meta)).toMatchObject({ ok: false, status: 403, error: 'self_forbidden' });
  });
  it('404 for a missing / deleted user', async () => {
    expect(await adminResetPassword(actor, 'nope', {}, meta)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('adminResetTotp', () => {
  it('clears TOTP for a TOTP role, signs out, audits', async () => {
    const r = await adminResetTotp(actor, 'k1', meta);
    expect(r.ok).toBe(true);
    expect(users.get('k1')!.totpEnabledAt).toBeNull();
    expect(users.get('k1')!.totpSecret).toBeNull();
    expect(auditFn).toHaveBeenCalledWith('auth.totp.reset', expect.objectContaining({ entityId: 'k1' }));
  });
  it('400 for a role without TOTP', async () => {
    expect(await adminResetTotp(actor, 'c1', meta)).toMatchObject({ ok: false, status: 400 });
  });
  it('refuses self', async () => {
    expect(await adminResetTotp(actor, 'su1', meta)).toMatchObject({ ok: false, error: 'self_forbidden' });
  });
});

describe('adminUnlock', () => {
  it('clears password lockout and phone-OTP lockouts', async () => {
    const r = await adminUnlock(actor, 'k1', meta);
    expect(r.ok).toBe(true);
    expect(sec.recordLoginSuccess).toHaveBeenCalledWith('k1@x.com');
    expect(db.otpAttempt.updateMany).toHaveBeenCalledWith({
      where: { id: { startsWith: '+911:' } },
      data: { attempts: 0, lockedUntil: null },
    });
    expect(auditFn).toHaveBeenCalledWith('platform.user.unlock', expect.anything());
  });
});

describe('adminSetRole', () => {
  it('changes role, signs the user out, audits before/after', async () => {
    const r = await adminSetRole(actor, 'c1', 'KITCHEN', meta);
    expect(r.ok).toBe(true);
    expect(users.get('c1')!.role).toBe('KITCHEN');
    expect(users.get('c1')!.currentSessionId).toBeNull();
    expect(auditFn).toHaveBeenCalledWith('platform.user.role.change', expect.objectContaining({ before: { role: 'CUSTOMER' }, after: expect.objectContaining({ role: 'KITCHEN' }) }));
  });
  it('KITCHEN -> ADMIN keeps restaurant memberships and re-roles them', async () => {
    await adminSetRole(actor, 'k1', 'ADMIN', meta);
    expect(db.restaurantUser.updateMany).toHaveBeenCalledWith({ where: { userId: 'k1' }, data: { role: 'ADMIN' } });
    expect(db.branchUser.updateMany).toHaveBeenCalledWith({ where: { userId: 'k1' }, data: { role: 'ADMIN' } });
    expect(db.restaurantUser.deleteMany).not.toHaveBeenCalled();
  });
  it('KITCHEN -> CUSTOMER removes restaurant/branch access and audits the count', async () => {
    await adminSetRole(actor, 'k1', 'CUSTOMER', meta);
    expect(db.restaurantUser.deleteMany).toHaveBeenCalledWith({ where: { userId: 'k1' } });
    expect(db.branchUser.deleteMany).toHaveBeenCalledWith({ where: { userId: 'k1' } });
    expect(auditFn).toHaveBeenCalledWith('platform.user.role.change', expect.objectContaining({ after: { role: 'CUSTOMER', restaurantMembershipsRemoved: 2, branchMembershipsRemoved: 1 } }));
  });
  it('refuses to move a restaurant owner off ADMIN (transfer ownership first)', async () => {
    users.set('o1', { id: 'o1', role: 'ADMIN', suspendedAt: null, deletedAt: null });
    db.restaurant.count.mockResolvedValueOnce(1);
    expect(await adminSetRole(actor, 'o1', 'CUSTOMER', meta)).toMatchObject({ ok: false, status: 409, error: 'restaurant_owner' });
  });
  it('refuses to change own role', async () => {
    expect(await adminSetRole(actor, 'su1', 'GUEST', meta)).toMatchObject({ ok: false, error: 'self_forbidden' });
  });
  it('refuses to demote the last active super admin', async () => {
    users.get('su2')!.suspendedAt = new Date(); // su1 is self; make su2 inactive
    users.set('su3', { id: 'su3', role: 'SUPER_ADMIN', suspendedAt: null, deletedAt: null });
    users.get('su1')!.suspendedAt = new Date();
    const r = await adminSetRole(actor, 'su3', 'GUEST', meta);
    expect(r).toMatchObject({ ok: false, status: 409, error: 'last_super_admin' });
  });
  it('rejects an unknown role', async () => {
    expect(await adminSetRole(actor, 'c1', 'OWNER' as any, meta)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('adminSetSuspended', () => {
  it('suspends with reason + signs out; unsuspend clears it', async () => {
    expect((await adminSetSuspended(actor, 'k1', true, 'fraud', meta)).ok).toBe(true);
    expect(users.get('k1')!.suspendedAt).toBeInstanceOf(Date);
    expect(users.get('k1')!.currentSessionId).toBeNull();
    expect(sessionsRevoked).toContain('k1');
    expect((await adminSetSuspended(actor, 'k1', false, undefined, meta)).ok).toBe(true);
    expect(users.get('k1')!.suspendedAt).toBeNull();
    expect(auditFn.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['platform.user.suspend', 'platform.user.reinstate']));
  });
  it('refuses to suspend self', async () => {
    expect(await adminSetSuspended(actor, 'su1', true, 'x', meta)).toMatchObject({ ok: false, error: 'self_forbidden' });
  });
  it('refuses to suspend the last active super admin', async () => {
    users.get('su1')!.suspendedAt = new Date();
    expect(await adminSetSuspended(actor, 'su2', true, 'x', meta)).toMatchObject({ ok: false, error: 'last_super_admin' });
  });
});

describe('adminSignOut', () => {
  it('rotates currentSessionId and revokes every session', async () => {
    users.get('k1')!.currentSessionId = 'sess-old';
    expect((await adminSignOut(actor, 'k1', meta)).ok).toBe(true);
    expect(users.get('k1')!.currentSessionId).toBeNull();
    expect(sessionsRevoked).toContain('k1');
    expect(auditFn).toHaveBeenCalledWith('platform.user.signout', expect.anything());
  });
});

describe('getUserActivity', () => {
  it('returns sessions + audit rows touching or by the user, without secrets', async () => {
    db.userSession.findMany.mockResolvedValue([{ id: 's1', createdAt: new Date(), lastSeenAt: new Date(), revokedAt: null, revokedReason: null, ipAddress: '1.1.1.1', userAgent: 'ua' }]);
    db.auditLog.findMany.mockResolvedValue([{ id: 'a1', action: 'auth.login.failed', actorId: 'k1', actorRole: 'KITCHEN', entityId: 'k1', createdAt: new Date(), ipAddress: null, after: { reason: 'totp_invalid' } }]);
    const r = await getUserActivity('k1');
    expect(r.sessions).toHaveLength(1);
    expect(r.events[0].action).toBe('auth.login.failed');
    const q = db.auditLog.findMany.mock.calls[0][0];
    expect(q.where.OR).toEqual([{ entityId: 'k1' }, { actorId: 'k1' }]);
  });
});
