import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  feedbackFindMany: vi.fn(),
  riderUpdate: vi.fn(),
  assignmentFindUnique: vi.fn()
}));

vi.mock('@/server/db', () => ({
  prisma: {
    orderFeedback: { findMany: m.feedbackFindMany },
    riderProfile: { update: m.riderUpdate },
    riderAssignment: { findUnique: m.assignmentFindUnique }
  }
}));
vi.mock('@/server/log', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { recomputeRiderRating, recomputeRiderRatingForOrder, RIDER_RATING_WINDOW } from '@/server/reviews/rider-rating';
import { defaultScorer } from '@/server/rider-allocator';

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
});

describe('recomputeRiderRating', () => {
  it('sets the rating from a single feedback', async () => {
    m.feedbackFindMany.mockResolvedValue([{ deliveryRating: 3 }]);
    await recomputeRiderRating('r1');
    expect(m.riderUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { rating: 3 } });
  });

  it('averages across many feedbacks and queries the bounded window', async () => {
    m.feedbackFindMany.mockResolvedValue([{ deliveryRating: 5 }, { deliveryRating: 4 }, { deliveryRating: 3 }]);
    await recomputeRiderRating('r1');
    expect(m.riderUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { rating: 4 } });
    const arg = m.feedbackFindMany.mock.calls[0][0];
    expect(arg.take).toBe(RIDER_RATING_WINDOW);
    expect(RIDER_RATING_WINDOW).toBe(100);
    expect(arg.where.deliveryRating).toEqual({ not: null });
    expect(arg.where.order.assignment).toEqual({ riderId: 'r1', status: 'DELIVERED' });
  });

  it('keeps the default (no write) when there is no feedback', async () => {
    m.feedbackFindMany.mockResolvedValue([]);
    await recomputeRiderRating('r1');
    expect(m.riderUpdate).not.toHaveBeenCalled();
  });

  it('never throws when the DB fails', async () => {
    m.feedbackFindMany.mockRejectedValue(new Error('db down'));
    await expect(recomputeRiderRating('r1')).resolves.toBeUndefined();
    m.feedbackFindMany.mockResolvedValue([{ deliveryRating: 4 }]);
    m.riderUpdate.mockRejectedValue(new Error('write fail'));
    await expect(recomputeRiderRating('r1')).resolves.toBeUndefined();
  });

  it('feeds the allocator: lower rating worsens the score', async () => {
    m.feedbackFindMany.mockResolvedValue([{ deliveryRating: 2 }]);
    await recomputeRiderRating('r1');
    const written = m.riderUpdate.mock.calls[0][0].data.rating;
    const mk = (rating: number) =>
      defaultScorer({
        rider: { id: 'r1', lat: null, lng: null, load: 0, rating },
        branch: { lat: null, lng: null },
        delivery: {}
      } as any);
    expect(mk(written)).toBeGreaterThan(mk(5));
  });
});

describe('recomputeRiderRatingForOrder', () => {
  it('resolves the rider from the order assignment and recomputes', async () => {
    m.assignmentFindUnique.mockResolvedValue({ riderId: 'r9' });
    m.feedbackFindMany.mockResolvedValue([{ deliveryRating: 5 }]);
    await recomputeRiderRatingForOrder('o1');
    expect(m.assignmentFindUnique).toHaveBeenCalledWith({ where: { orderId: 'o1' }, select: { riderId: true } });
    expect(m.riderUpdate).toHaveBeenCalledWith({ where: { id: 'r9' }, data: { rating: 5 } });
  });

  it('does nothing without an assignment, and never throws', async () => {
    m.assignmentFindUnique.mockResolvedValue(null);
    await recomputeRiderRatingForOrder('o1');
    expect(m.riderUpdate).not.toHaveBeenCalled();
    m.assignmentFindUnique.mockRejectedValue(new Error('boom'));
    await expect(recomputeRiderRatingForOrder('o1')).resolves.toBeUndefined();
  });
});
