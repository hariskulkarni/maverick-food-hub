import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({ order: { findMany: vi.fn(), findFirst: vi.fn() }, googleReview: { updateMany: vi.fn() } }));
vi.mock('@/server/db', () => ({ prisma: db }));

import { nameSimilarity, matchConfidence, findOrderMatch, matchAndStore, getOrderContext, privateContextText, dice, MATCH_WINDOW_HOURS } from '@/server/reviews/order-match';

beforeEach(() => vi.clearAllMocks());

describe('name similarity', () => {
  it('scores exact, first+initial, first-only, and fuzzy names', () => {
    expect(nameSimilarity('Asha Rao', 'asha  rao')).toBe(1);
    expect(nameSimilarity('Asha R', 'Asha Rao')).toBe(0.9);
    expect(nameSimilarity('Asha', 'Asha Rao')).toBe(0.75);
    expect(nameSimilarity('Asha Kumar', 'Asha Rao')).toBe(0.6);
    expect(nameSimilarity('Zoe', 'Asha Rao')).toBeLessThan(0.4);
    expect(nameSimilarity(null, 'Asha')).toBe(0);
  });
  it('dice is symmetric and 1 for equal strings', () => {
    expect(dice('night', 'nacht')).toBe(dice('nacht', 'night'));
    expect(dice('abc', 'abc')).toBe(1);
  });
  it('confidence decays up to 20% over the window', () => {
    expect(matchConfidence(1, 0)).toBe(1);
    expect(matchConfidence(1, MATCH_WINDOW_HOURS)).toBe(0.8);
    expect(matchConfidence(1, 1000)).toBe(0.8);
  });
});

describe('findOrderMatch', () => {
  const at = new Date('2026-10-20T12:00:00Z');
  it('queries delivered orders of THIS restaurant in the prior 72h and picks the best match', async () => {
    db.order.findMany.mockResolvedValue([
      { id: 'o1', deliveredAt: new Date('2026-10-20T10:00:00Z'), customer: { name: 'Asha' } },
      { id: 'o2', deliveredAt: new Date('2026-10-20T11:00:00Z'), customer: { name: 'Asha Rao' } },
      { id: 'o3', deliveredAt: new Date('2026-10-20T11:30:00Z'), customer: { name: 'Vikram' } },
    ]);
    expect(await findOrderMatch('rest1', { reviewerName: 'Asha Rao', reviewCreatedAt: at })).toEqual({ orderId: 'o2', confidence: 1 });
    const where = db.order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ branch: { restaurantId: 'rest1' }, status: 'DELIVERED' });
    expect(where.deliveredAt.gte).toEqual(new Date(at.getTime() - 72 * 3_600_000));
    expect(where.deliveredAt.lte).toEqual(at);
  });
  it('returns null below the confidence threshold or without a reviewer name', async () => {
    db.order.findMany.mockResolvedValue([{ id: 'o3', deliveredAt: at, customer: { name: 'Vikram' } }]);
    expect(await findOrderMatch('rest1', { reviewerName: 'Asha', reviewCreatedAt: at })).toBeNull();
    expect(await findOrderMatch('rest1', { reviewerName: ' ', reviewCreatedAt: at })).toBeNull();
  });
  it('matchAndStore writes the suggestion tenant-scoped', async () => {
    db.order.findMany.mockResolvedValue([]);
    await matchAndStore('rest1', { id: 'g1', reviewerName: 'Asha', reviewCreatedAt: at });
    expect(db.googleReview.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', restaurantId: 'rest1' },
      data: expect.objectContaining({ matchedOrderId: null, matchConfidence: null, matchCheckedAt: expect.any(Date) }),
    });
  });
});

describe('getOrderContext + privateContextText', () => {
  it('scopes to the restaurant and computes lateness, rider and private terms', async () => {
    db.order.findFirst.mockResolvedValue({
      id: 'o1', code: 'ORD-AB12', deliveredAt: new Date('2026-10-20T12:25:00Z'), estimatedDeliveryAt: new Date('2026-10-20T12:00:00Z'),
      items: [{ name: 'Chicken Biryani', quantity: 2 }], customer: { phone: '+919999999999' },
      assignment: { rider: { user: { name: 'Ravi Kumar' } } },
    });
    const c = (await getOrderContext('rest1', 'o1', 0.9))!;
    expect(db.order.findFirst.mock.calls[0][0].where).toEqual({ id: 'o1', branch: { restaurantId: 'rest1' } });
    expect(c.lateByMin).toBe(25);
    expect(c.riderName).toBe('Ravi Kumar');
    expect(c.privateTerms).toEqual(['ORD-AB12', 'Ravi Kumar', 'Ravi', '+919999999999']);
    const text = privateContextText(c)!;
    expect(text).toContain('Chicken Biryani x2');
    expect(text).toContain('25 minutes later');
    expect(text).not.toContain('ORD-AB12');
    expect(text).not.toContain('Ravi');
  });
  it('null for a foreign order', async () => {
    db.order.findFirst.mockResolvedValue(null);
    expect(await getOrderContext('rest1', 'oX', null)).toBeNull();
    expect(privateContextText(null)).toBeNull();
  });
});
