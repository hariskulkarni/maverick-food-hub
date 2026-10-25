/**
 * F1 — Google sign-in is a CUSTOMER login factor only. An existing staff /
 * platform / rider account must never get a session from Google alone (that
 * would bypass password, TOTP and the super-admin IP allowlist).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, auditFn } = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn(), create: vi.fn() } },
  auditFn: vi.fn(async () => {}),
}));
vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: auditFn }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next-auth', () => ({ default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }) }));
vi.mock('next-auth/providers/credentials', () => ({ default: (c: unknown) => c }));
vi.mock('next-auth/providers/google', () => ({ default: (c: unknown) => c }));
vi.mock('@/server/auth.config', () => ({ authEdgeConfig: {} }));
vi.mock('@/server/signup-bonus', () => ({ grantSignupBonus: vi.fn(async () => {}) }));

import { authConfig } from '@/server/auth';

const signIn = (email: string) =>
  (authConfig.callbacks!.signIn as any)({ user: { email, name: 'X' }, account: { provider: 'google' } });

beforeEach(() => { vi.clearAllMocks(); });

describe('F1: Google sign-in only for CUSTOMER accounts', () => {
  it('existing CUSTOMER signs in (control)', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'c1', role: 'CUSTOMER', deletedAt: null, suspendedAt: null });
    expect(await signIn('c@x.com')).toBe(true);
  });

  for (const role of ['SUPER_ADMIN', 'ADMIN', 'KITCHEN', 'RIDER', 'ADMIN_ASSIST', 'DEVELOPER', 'QA', 'GUEST']) {
    it(`existing ${role} is refused and audited`, async () => {
      db.user.findUnique.mockResolvedValue({ id: 'u1', role, deletedAt: null, suspendedAt: null });
      expect(await signIn('staff@x.com')).toBe(false);
      expect(auditFn).toHaveBeenCalledWith('auth.login.failed', expect.objectContaining({
        after: expect.objectContaining({ reason: 'google_role_blocked', provider: 'google' }),
      }));
    });
  }

  it('suspended CUSTOMER is refused', async () => {
    db.user.findUnique.mockResolvedValue({ id: 'c2', role: 'CUSTOMER', deletedAt: null, suspendedAt: new Date() });
    expect(await signIn('c2@x.com')).toBe(false);
  });
});
