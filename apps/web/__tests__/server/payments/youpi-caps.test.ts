import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsert, updateMany } = vi.hoisted(() => ({ upsert: vi.fn(), updateMany: vi.fn() }));
vi.mock('@/server/db', () => ({
  prisma: { youpiDailyUsage: { upsert, updateMany } },
}));

import {
  assertUnderCap,
  todayUtc,
  YoupiCapExceededError,
  YoupiAmountExceededError,
} from '@/server/payments/youpi-caps';

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({});
  updateMany.mockReset();
});

describe('assertUnderCap', () => {
  it('resolves when the conditional increment wins', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(assertUnderCap('r1', 100, { dailyLimit: 5 })).resolves.toBeUndefined();
    const today = todayUtc();
    expect(upsert).toHaveBeenCalledWith({
      where: { restaurantId_day: { restaurantId: 'r1', day: today } },
      create: { restaurantId: 'r1', day: today, count: 0 },
      update: {},
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { restaurantId: 'r1', day: today, count: { lt: 5 } },
      data: { count: { increment: 1 } },
    });
  });

  it('throws YoupiCapExceededError at the cap', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(assertUnderCap('r1', 100, { dailyLimit: 5 })).rejects.toBeInstanceOf(
      YoupiCapExceededError,
    );
  });

  it('throws YoupiAmountExceededError over max amount without touching the counter', async () => {
    await expect(
      assertUnderCap('r1', 1001, { dailyLimit: 5, maxAmountPaise: 1000 }),
    ).rejects.toBeInstanceOf(YoupiAmountExceededError);
    expect(upsert).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('allows amount equal to max', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await expect(
      assertUnderCap('r1', 1000, { maxAmountPaise: 1000 }),
    ).resolves.toBeUndefined();
  });

  it('defaults dailyLimit to 20', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    await assertUnderCap('r1', 100, {});
    expect(updateMany.mock.calls[0][0].where.count).toEqual({ lt: 20 });
  });
});
