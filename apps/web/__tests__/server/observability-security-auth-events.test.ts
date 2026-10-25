/**
 * Merge reconciliation: the Observability security tab counts the new auth
 * events correctly — recovery-code sign-ins are their own figure (not a TOTP
 * "reset"), resets count only real authenticator resets/clears.
 */
import { describe, it, expect, vi } from 'vitest';

const authRows = [
  { action: 'auth.totp.reset', _count: { _all: 2 } },
  { action: 'auth.totp.cleared_by_reset', _count: { _all: 1 } },
  { action: 'auth.totp.recovery_code_used', _count: { _all: 4 } },
  { action: 'auth.login.locked', _count: { _all: 3 } },
  { action: 'auth.password.changed_after_reset', _count: { _all: 5 } },
];
vi.mock('@/server/db', () => ({
  prisma: {
    auditLog: {
      groupBy: vi.fn(async (q: any) => (q.where.action?.startsWith === 'auth.' ? authRows : [])),
      findMany: vi.fn(async () => []),
    },
    obsEventMinute: { groupBy: vi.fn(async () => []) },
    paymentWebhookEvent: { groupBy: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
  },
}));

import { securitySnapshot } from '@/server/observability/q-ops';

describe('securitySnapshot auth events', () => {
  it('separates recovery-code use from authenticator resets; counts lockouts', async () => {
    const s = await securitySnapshot(new Date(0));
    expect(s.twoFactor.resets).toBe(3);
    expect(s.twoFactor.recoveryCodesUsed).toBe(4);
    expect(s.logins.lockouts).toBe(3);
    expect(s.passwordResets).toBe(5);
  });
});
