import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * applyIncentivesForDelivery advances a rider's incentive progress after a
 * delivery and pays the flat bonus exactly once when a slab is achieved. We
 * mock prisma so the logic can be exercised without a database.
 */
const db: any = vi.hoisted(() => ({
  riderIncentive: { findMany: vi.fn() },
  riderAssignment: { count: vi.fn() },
  riderIncentiveProgress: { upsert: vi.fn(), updateMany: vi.fn() },
  riderProfile: { update: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('@/server/db', () => ({ prisma: db }));
vi.mock('@/server/audit', () => ({ audit: vi.fn().mockResolvedValue(undefined) }));

import { applyIncentivesForDelivery } from '@/server/rider-payments';

const DAILY = {
  id: 'inc1',
  title: 'Daily 3',
  period: 'DAILY',
  targetDeliveries: 3,
  bonusAmount: 50,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: the transaction runs its callback against a tx that mirrors db.
  db.$transaction.mockImplementation(async (fn: any) =>
    fn({
      riderIncentiveProgress: { updateMany: db.riderIncentiveProgress.updateMany },
      riderProfile: { update: db.riderProfile.update },
    })
  );
});

describe('applyIncentivesForDelivery', () => {
  it('credits the bonus once when the target is reached', async () => {
    db.riderIncentive.findMany.mockResolvedValue([DAILY]);
    db.riderAssignment.count.mockResolvedValue(3); // target hit
    db.riderIncentiveProgress.upsert.mockResolvedValue({ id: 'p1', bonusPaid: false });
    db.riderIncentiveProgress.updateMany.mockResolvedValue({ count: 1 }); // we claimed it
    db.riderProfile.update.mockResolvedValue({});

    const out = await applyIncentivesForDelivery('rider1');
    expect(out).toHaveLength(1);
    expect(out[0].achieved).toBe(true);
    expect(out[0].bonusCredited).toBe(50);
    expect(db.riderProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rider1' } })
    );
  });

  it('does not credit when the target is not yet reached', async () => {
    db.riderIncentive.findMany.mockResolvedValue([DAILY]);
    db.riderAssignment.count.mockResolvedValue(2); // below target
    db.riderIncentiveProgress.upsert.mockResolvedValue({ id: 'p1', bonusPaid: false });

    const out = await applyIncentivesForDelivery('rider1');
    expect(out[0].achieved).toBe(false);
    expect(out[0].bonusCredited).toBe(0);
    expect(db.riderProfile.update).not.toHaveBeenCalled();
  });

  it('does not double-pay an already-paid slab', async () => {
    db.riderIncentive.findMany.mockResolvedValue([DAILY]);
    db.riderAssignment.count.mockResolvedValue(5); // well past target
    db.riderIncentiveProgress.upsert.mockResolvedValue({ id: 'p1', bonusPaid: true });

    const out = await applyIncentivesForDelivery('rider1');
    expect(out[0].achieved).toBe(true);
    expect(out[0].bonusCredited).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.riderProfile.update).not.toHaveBeenCalled();
  });

  it('loses the race gracefully (another writer already claimed the bonus)', async () => {
    db.riderIncentive.findMany.mockResolvedValue([DAILY]);
    db.riderAssignment.count.mockResolvedValue(3);
    db.riderIncentiveProgress.upsert.mockResolvedValue({ id: 'p1', bonusPaid: false });
    db.riderIncentiveProgress.updateMany.mockResolvedValue({ count: 0 }); // lost the race
    const out = await applyIncentivesForDelivery('rider1');
    expect(out[0].bonusCredited).toBe(0);
    expect(db.riderProfile.update).not.toHaveBeenCalled();
  });

  it('returns [] when there are no active incentives', async () => {
    db.riderIncentive.findMany.mockResolvedValue([]);
    const out = await applyIncentivesForDelivery('rider1');
    expect(out).toEqual([]);
  });
});
