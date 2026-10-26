/**
 * Lead item 2: the password-login lockout is persisted (LoginLockout rows), so
 * a deploy/restart or another PM2 instance does not reset it; success clears it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = new Map<string, any>();
const db = vi.hoisted(() => ({
  loginLockout: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

beforeEach(() => {
  rows.clear();
  vi.resetModules();
  db.loginLockout.findUnique.mockImplementation(async ({ where }: any) => rows.get(where.email) ?? null);
  db.loginLockout.upsert.mockImplementation(async ({ where, create, update }: any) => {
    const cur = rows.get(where.email);
    const next = cur ? { ...cur, ...update } : { ...create };
    rows.set(where.email, next);
    return next;
  });
  db.loginLockout.deleteMany.mockImplementation(async ({ where }: any) => { rows.delete(where.email); return { count: 1 }; });
});

describe('persistent login lockout', () => {
  it('locks after 5 failures and survives a module reload (restart)', async () => {
    let m = await import('@/server/2fa');
    for (let i = 0; i < 5; i++) await m.recordLoginFailure('a@x.com', 15);
    expect(await m.isLockedOut('a@x.com')).toBe(true);
    vi.resetModules();
    m = await import('@/server/2fa');
    expect(await m.isLockedOut('a@x.com')).toBe(true);
    const left = await m.lockoutRemainingMs('a@x.com');
    expect(left).toBeGreaterThan(14 * 60_000);
    expect(left).toBeLessThanOrEqual(15 * 60_000);
  });
  it('4 failures do not lock; success clears the counter', async () => {
    const m = await import('@/server/2fa');
    for (let i = 0; i < 4; i++) await m.recordLoginFailure('b@x.com', 15);
    expect(await m.isLockedOut('b@x.com')).toBe(false);
    await m.recordLoginSuccess('b@x.com');
    expect(rows.has('b@x.com')).toBe(false);
  });
  it('an expired lockout no longer blocks', async () => {
    const m = await import('@/server/2fa');
    rows.set('c@x.com', { email: 'c@x.com', failures: 5, firstFailureAt: new Date(Date.now() - 3600_000), lockedUntil: new Date(Date.now() - 1000) });
    expect(await m.isLockedOut('c@x.com')).toBe(false);
  });
  it('a DB error fails open (never locks everyone out on a blip)', async () => {
    const m = await import('@/server/2fa');
    db.loginLockout.findUnique.mockRejectedValueOnce(new Error('db down'));
    expect(await m.isLockedOut('d@x.com')).toBe(false);
  });
});
