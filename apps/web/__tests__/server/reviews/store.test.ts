import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  googleReview: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  reviewReply: { upsert: vi.fn() },
  reviewAutoReplyConfig: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import { upsertReview, getReviewScoped, saveReply, listReviewsForAdmin, setPlacesLink, getPlacesLink, clearPlacesLink } from '@/server/reviews/store';

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

describe('places-sourced reviews', () => {
  const base = { googleReviewId: 'places:p1:1', reviewerName: 'A', rating: 5, comment: 'x', reviewCreatedAt: new Date() };
  it('defaults source to gbp and honours places', async () => {
    db.googleReview.upsert.mockResolvedValue({ id: 'g1' });
    await upsertReview('rest1', { ...base, googleReviewId: 'accounts/1' });
    expect(db.googleReview.upsert.mock.calls[0][0].create.source).toBe('gbp');
    await upsertReview('rest1', { ...base, source: 'places' });
    const arg = db.googleReview.upsert.mock.calls[1][0];
    expect(arg.create.source).toBe('places');
    expect(arg.update.source).toBeUndefined(); // re-sync never flips an existing row's source
  });
  it('listReviewsForAdmin returns the source field (gbp and places coexist)', async () => {
    db.googleReview.findMany.mockResolvedValue([
      { id: 'a', source: 'gbp' }, { id: 'b', source: 'places' },
    ]);
    const rows = await listReviewsForAdmin('rest1');
    expect(rows.map((r: any) => r.source)).toEqual(['gbp', 'places']);
    expect(db.googleReview.findMany.mock.calls[0][0].include).toEqual({ reply: true });
  });
  it('setPlacesLink upserts onto the per-restaurant config row', async () => {
    await setPlacesLink('rest1', { placeId: 'p1', name: 'N' });
    const arg = db.reviewAutoReplyConfig.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ restaurantId: 'rest1' });
    expect(arg.create).toMatchObject({ restaurantId: 'rest1', googlePlaceId: 'p1', googlePlaceName: 'N' });
    expect(arg.update).toMatchObject({ googlePlaceId: 'p1', googlePlaceName: 'N' });
  });
  it('getPlacesLink returns null when unlinked', async () => {
    db.reviewAutoReplyConfig.findUnique.mockResolvedValue({ googlePlaceId: null, googlePlaceName: null });
    expect(await getPlacesLink('rest1')).toBeNull();
    db.reviewAutoReplyConfig.findUnique.mockResolvedValue({ googlePlaceId: 'p1', googlePlaceName: 'N' });
    expect(await getPlacesLink('rest1')).toEqual({ placeId: 'p1', name: 'N' });
  });
  it('clearPlacesLink nulls the link and deletes only this tenant\'s places reviews', async () => {
    await clearPlacesLink('rest1');
    expect(db.googleReview.deleteMany).toHaveBeenCalledWith({ where: { restaurantId: 'rest1', source: 'places' } });
    expect(db.reviewAutoReplyConfig.upsert.mock.calls.at(-1)![0].update).toMatchObject({ googlePlaceId: null, googlePlaceName: null, googlePlaceConnectedAt: null });
  });
});
