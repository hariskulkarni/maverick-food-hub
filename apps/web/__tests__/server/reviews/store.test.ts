import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  googleReview: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  reviewReply: { upsert: vi.fn() },
  reviewAutoReplyConfig: { findUnique: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { upsertReview, getReviewScoped, saveReply, listReviewsForAdmin } from '@/server/reviews/store';

beforeEach(() => vi.clearAllMocks());

describe('upsertReview', () => {
  it('scopes the upsert by googleReviewId and records restaurantId', async () => {
    db.googleReview.upsert.mockResolvedValue({ id: 'g1' });
    const r = await upsertReview('rest1', {
      googleReviewId: 'accounts/1/locations/2/reviews/9', reviewerName: 'A',
      rating: 5, comment: 'x', reviewCreatedAt: new Date('2026-10-18T00:00:00Z'),
    });
    expect(r.id).toBe('g1');
    const arg = db.googleReview.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ googleReviewId: 'accounts/1/locations/2/reviews/9' });
    expect(arg.create.restaurantId).toBe('rest1');
  });
});

describe('getReviewScoped', () => {
  it('queries with BOTH id and restaurantId (fail-closed tenant scope)', async () => {
    db.googleReview.findFirst.mockResolvedValue(null);
    const out = await getReviewScoped('rest1', 'g1');
    expect(out).toBeNull();
    expect(db.googleReview.findFirst.mock.calls[0][0].where).toEqual({ id: 'g1', restaurantId: 'rest1' });
  });
});

describe('listReviewsForAdmin', () => {
  it('always includes restaurantId in the where clause', async () => {
    db.googleReview.findMany.mockResolvedValue([]);
    await listReviewsForAdmin('rest1', { rating: 2 });
    const where = db.googleReview.findMany.mock.calls[0][0].where;
    expect(where.restaurantId).toBe('rest1');
    expect(where.rating).toBe(2);
  });
});

describe('saveReply', () => {
  it('upserts keyed on reviewId with the given state + source', async () => {
    db.reviewReply.upsert.mockResolvedValue({});
    await saveReply({ reviewId: 'g1', restaurantId: 'rest1', text: 'hi', state: 'POSTED' as any, source: 'AUTO' as any, postedAt: new Date() });
    const arg = db.reviewReply.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ reviewId: 'g1' });
    expect(arg.create.state).toBe('POSTED');
    expect(arg.create.source).toBe('AUTO');
  });
});
