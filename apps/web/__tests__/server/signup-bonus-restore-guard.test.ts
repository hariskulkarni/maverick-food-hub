/**
 * H10 — commitSignupBonusForOrder must not commit a bonus hold that was already
 * RESTORED (order expired/cancelled then retried+delivered), which would mint
 * bonus money and drive pendingAmount negative.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findFirst = vi.fn();
const $transaction = vi.fn();

vi.mock('@/server/db', () => ({
  prisma: { signupBonusLedger: { findFirst: (...a: any[]) => findFirst(...a) }, $transaction: (...a: any[]) => $transaction(...a) }
}));
vi.mock('@/server/audit', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import { commitSignupBonusForOrder } from '@/server/signup-bonus';

beforeEach(() => { findFirst.mockReset(); $transaction.mockReset(); });

describe('H10: commit refuses a restored bonus', () => {
  it('returns early (no $transaction) when a RESTORE ledger entry exists', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'apply1', grantId: 'g1', delta: 100 }) // APPLY
      .mockResolvedValueOnce(null)                                        // COMMIT
      .mockResolvedValueOnce({ id: 'restore1' });                        // RESTORE
    await commitSignupBonusForOrder('o1');
    expect($transaction).not.toHaveBeenCalled();
  });

  it('commits when APPLY exists and no COMMIT/RESTORE', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'apply1', grantId: 'g1', delta: 100 }) // APPLY
      .mockResolvedValueOnce(null)                                        // COMMIT
      .mockResolvedValueOnce(null);                                       // RESTORE
    $transaction.mockImplementation(async (fn: any) =>
      fn({ signupBonusGrant: { update: vi.fn() }, signupBonusLedger: { create: vi.fn() } })
    );
    await commitSignupBonusForOrder('o1');
    expect($transaction).toHaveBeenCalled();
  });
});
