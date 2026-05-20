/**
 * Unit tests for the freebie engine's selection + grant/restore logic.
 *
 * resolveQualifyingFreebie + grantFreebieTx + restoreFreebieStock all touch
 * Prisma, so we mock the prisma client. The behaviour we pin down:
 *   - freebies off ⇒ never returns a freebie (short-circuit, no query)
 *   - picks the BEST (highest-threshold) qualifying in-stock rule
 *   - skips rules whose gift item is unavailable
 *   - grant is an atomic conditional decrement; losing the last unit ⇒ null
 *   - restore increments stock back
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the prisma singleton used by freebies.ts ────────────────────────────
const findMany = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
vi.mock('@/server/db', () => ({
  prisma: {
    freebieRule: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

import {
  resolveQualifyingFreebie,
  grantFreebieTx,
  restoreFreebieStock,
} from '@/server/freebies';

beforeEach(() => {
  findMany.mockReset();
  updateMany.mockReset();
  update.mockReset();
});

describe('resolveQualifyingFreebie', () => {
  it('returns null immediately when freebies are disabled (no query)', async () => {
    const r = await resolveQualifyingFreebie('branch-1', 500, false);
    expect(r).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns the best qualifying in-stock rule with an available gift item', async () => {
    // The query is already ordered minOrderAmount desc, so the first
    // available-item row is the winner. Simulate that ordering.
    findMany.mockResolvedValue([
      { id: 'r799', name: 'Free cake over 799', menuItemId: 'm1', stock: 3, menuItem: { id: 'm1', name: 'Chocolate Cake', isAvailable: true } },
      { id: 'r399', name: 'Free soda over 399', menuItemId: 'm2', stock: 9, menuItem: { id: 'm2', name: 'Cola', isAvailable: true } },
    ]);
    const r = await resolveQualifyingFreebie('branch-1', 900, true);
    expect(r).toEqual({
      ruleId: 'r799',
      ruleName: 'Free cake over 799',
      menuItemId: 'm1',
      itemName: 'Chocolate Cake',
      stockBefore: 3,
    });
  });

  it('skips a rule whose gift item is 86’d and falls to the next', async () => {
    findMany.mockResolvedValue([
      { id: 'r799', name: 'Free cake', menuItemId: 'm1', stock: 3, menuItem: { id: 'm1', name: 'Cake', isAvailable: false } },
      { id: 'r399', name: 'Free soda', menuItemId: 'm2', stock: 9, menuItem: { id: 'm2', name: 'Cola', isAvailable: true } },
    ]);
    const r = await resolveQualifyingFreebie('branch-1', 900, true);
    expect(r?.ruleId).toBe('r399');
  });

  it('returns null when no rule qualifies / all out of stock (empty query result)', async () => {
    findMany.mockResolvedValue([]);
    const r = await resolveQualifyingFreebie('branch-1', 100, true);
    expect(r).toBeNull();
  });
});

describe('grantFreebieTx', () => {
  const freebie = { ruleId: 'r1', ruleName: 'Free cake', menuItemId: 'm1', itemName: 'Cake', stockBefore: 2 };

  it('claims a unit and returns the ₹0 gift line when stock is available', async () => {
    const tx = { freebieRule: { updateMany: (...a: unknown[]) => updateMany(...a) } } as any;
    updateMany.mockResolvedValue({ count: 1 });
    const line = await grantFreebieTx(tx, freebie);
    expect(line).not.toBeNull();
    expect(line!.menuItemId).toBe('m1');
    expect(line!.isFreebie).toBe(true);
    expect(line!.quantity).toBe(1);
    expect(Number(line!.unitPrice)).toBe(0);
    // The conditional decrement is what makes it race-safe.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', stock: { gt: 0 } },
        data: expect.objectContaining({ stock: { decrement: 1 }, totalGranted: { increment: 1 } }),
      })
    );
  });

  it('returns null when the last unit was lost to a race (count 0)', async () => {
    const tx = { freebieRule: { updateMany: (...a: unknown[]) => updateMany(...a) } } as any;
    updateMany.mockResolvedValue({ count: 0 });
    const line = await grantFreebieTx(tx, freebie);
    expect(line).toBeNull();
  });
});

describe('restoreFreebieStock', () => {
  it('increments stock + decrements totalGranted', async () => {
    update.mockResolvedValue({});
    await restoreFreebieStock('r1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: { stock: { increment: 1 }, totalGranted: { decrement: 1 } },
      })
    );
  });

  it('swallows errors when the rule no longer exists', async () => {
    update.mockRejectedValue(new Error('record not found'));
    await expect(restoreFreebieStock('gone')).resolves.toBeUndefined();
  });
});
