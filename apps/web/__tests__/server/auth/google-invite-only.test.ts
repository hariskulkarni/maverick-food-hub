/**
 * ALLOW_CUSTOMER_SELF_SIGNUP=false still refuses Google sign-in for an unknown
 * email (no account is created) — it now lands on the friendly invite-only
 * screen instead of the generic auth error. With sign-up open a new Google
 * customer is created WITHOUT a verified phone (the phone step comes next).
 * The session exposes the phone-verified flag read live from the DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { db, auditFn, session } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
  auditFn: vi.fn(async () => {}),
  session: { isSessionActive: vi.fn(async () => true), startSession: vi.fn(async () => 'sid1'), revokeSession: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: auditFn }));
vi.mock('@/server/sessions', () => session);
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock('next-auth/providers/credentials', () => ({ default: (c: unknown) => c }));
vi.mock('next-auth/providers/google', () => ({ default: (c: unknown) => c }));
vi.mock('@/server/auth.config', () => ({ authEdgeConfig: {} }));
vi.mock('@/server/signup-bonus', () => ({ grantSignupBonus: vi.fn(async () => {}) }));
vi.mock('@/server/otp', () => ({ sendOtp: vi.fn(), verifyOtp: vi.fn(async () => true) }));

import { authConfig } from '@/server/auth';

const googleSignIn = (email: string) =>
  (authConfig.callbacks!.signIn as any)({ user: { email, name: 'New Person' }, account: { provider: 'google' } });

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('Google sign-in with ALLOW_CUSTOMER_SELF_SIGNUP', () => {
  it('false: unknown email is refused to the invite-only screen and nothing is created', async () => {
    vi.stubEnv('ALLOW_CUSTOMER_SELF_SIGNUP', 'false');
    db.user.findUnique.mockResolvedValue(null);
    expect(await googleSignIn('new@x.com')).toBe('/login/invite-only');
    expect(db.user.create).not.toHaveBeenCalled();
    expect(auditFn).toHaveBeenCalledWith('auth.login.unregistered', expect.objectContaining({ after: { email: 'new@x.com', provider: 'google' } }));
  });
  it('false: an existing customer still signs in with Google', async () => {
    vi.stubEnv('ALLOW_CUSTOMER_SELF_SIGNUP', 'false');
    db.user.findUnique.mockResolvedValue({ id: 'c1', role: 'CUSTOMER', deletedAt: null, suspendedAt: null });
    expect(await googleSignIn('c@x.com')).toBe(true);
  });
  it('open: a new Google customer is created without a phone (phone step follows)', async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: 'g1' });
    expect(await googleSignIn('New@X.com')).toBe(true);
    expect(db.user.create).toHaveBeenCalledWith({ data: { email: 'new@x.com', name: 'New Person', role: 'CUSTOMER' } });
  });
});

describe('phone-verified flag on the session', () => {
  it('jwt reads phoneVerifiedAt from the DB; session exposes it', async () => {
    db.user.findUnique.mockResolvedValueOnce({ id: 'g1', role: 'CUSTOMER', phone: null, phoneVerifiedAt: null, email: 'g@x.com', name: 'G', branchMemberships: [] });
    const t1 = await (authConfig.callbacks!.jwt as any)({ token: { uid: 'g1', sid: 's' } });
    expect(t1.phoneVerified).toBe(false);
    db.user.findUnique.mockResolvedValueOnce({ id: 'g1', role: 'CUSTOMER', phone: '+919876543210', phoneVerifiedAt: new Date(), email: 'g@x.com', name: 'G', branchMemberships: [] });
    const t2 = await (authConfig.callbacks!.jwt as any)({ token: { uid: 'g1', sid: 's' } });
    expect(t2.phoneVerified).toBe(true);
    const s = await (authConfig.callbacks!.session as any)({ session: { user: {} }, token: t2 });
    expect(s.user.phoneVerified).toBe(true);
  });
});

describe('phone-otp sign-in records the OTP-proven phone as verified', () => {
  const provider = () => (authConfig.providers as any[]).find((p) => p.id === 'phone-otp');
  it('new customer is created verified', async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue({ id: 'n1', name: null, email: null });
    await provider().authorize({ phone: '+919876543210', code: '123456' });
    expect(db.user.create).toHaveBeenCalledWith({ data: { phone: '+919876543210', role: 'CUSTOMER', phoneVerifiedAt: expect.any(Date) } });
  });
  it('existing unverified customer is marked verified', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'e1', role: 'CUSTOMER', phoneVerifiedAt: null, deletedAt: null, suspendedAt: null });
    await provider().authorize({ phone: '+919876543210', code: '123456' });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { phoneVerifiedAt: expect.any(Date) } });
  });
});
