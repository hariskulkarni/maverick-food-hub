import { describe, it, expect, vi, beforeEach } from 'vitest';

const db: any = vi.hoisted(() => ({
  googleReview: { upsert: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  reviewReply: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  reviewAutoReplyConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  reviewResponseSettings: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock('@/server/db', () => ({ prisma: db }));

import {
  upsertReview, getReviewScoped, saveReply, listReviewsForAdmin, setPlacesLink, getPlacesLink, clearPlacesLink,
  syncGoogleReply, getResponseSettings, saveGoogleStats, recentPostedReplies, overdueWhere, ADMIN_PAGE_SIZE,
} from '@/server/reviews/store';

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
    const { items: rows } = await listReviewsForAdmin('rest1');
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

describe('upsertReview edits', () => {
  it('refreshes rating/comment/updateTime on an edited review and reports edited', async () => {
    db.googleReview.findFirst.mockResolvedValue({ id: 'g1', rating: 5, comment: 'Great' });
    db.googleReview.upsert.mockResolvedValue({ id: 'g1' });
    const upd = new Date('2026-10-20T00:00:00Z');
    const r = await upsertReview('rest1', { googleReviewId: 'x', reviewerName: 'A', rating: 2, comment: 'Changed my mind', reviewCreatedAt: new Date('2026-10-01'), reviewUpdatedAt: upd });
    expect(r).toEqual({ id: 'g1', isNew: false, edited: true });
    const arg = db.googleReview.upsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({ rating: 2, comment: 'Changed my mind', reviewUpdatedAt: upd });
    expect(arg.update.reviewCreatedAt).toBeUndefined();
  });
  it('is not edited when nothing changed', async () => {
    db.googleReview.findFirst.mockResolvedValue({ id: 'g1', rating: 5, comment: 'Great' });
    db.googleReview.upsert.mockResolvedValue({ id: 'g1' });
    const r = await upsertReview('rest1', { googleReviewId: 'x', reviewerName: 'A', rating: 5, comment: 'Great', reviewCreatedAt: new Date() });
    expect(r.edited).toBe(false);
  });
});

describe('syncGoogleReply', () => {
  const reply = { comment: 'Thanks!', updateTime: new Date('2026-10-05'), moderationState: 'APPROVED', policyViolation: null, reviewReplyUrl: 'https://g.page/r' };
  it('imports a Google-side reply as POSTED/MANUAL with Google time and no LLM fields', async () => {
    db.reviewReply.findUnique.mockResolvedValue(null);
    expect(await syncGoogleReply('g1', 'rest1', reply)).toBe(true);
    const arg = db.reviewReply.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ reviewId: 'g1', restaurantId: 'rest1', text: 'Thanks!', state: 'POSTED', source: 'MANUAL', postedAt: reply.updateTime, llmProvider: null, reviewReplyUrl: 'https://g.page/r' });
  });
  it('overwrites a local pending draft when the owner replied on Google directly', async () => {
    db.reviewReply.findUnique.mockResolvedValue({ state: 'PENDING_APPROVAL' });
    expect(await syncGoogleReply('g1', 'rest1', reply)).toBe(true);
    expect(db.reviewReply.upsert.mock.calls[0][0].update.state).toBe('POSTED');
  });
  it('only refreshes moderation fields on an existing POSTED reply', async () => {
    db.reviewReply.findUnique.mockResolvedValue({ state: 'POSTED' });
    expect(await syncGoogleReply('g1', 'rest1', { ...reply, moderationState: 'REJECTED', policyViolation: 'Contact info' })).toBe(false);
    expect(db.reviewReply.upsert).not.toHaveBeenCalled();
    expect(db.reviewReply.update).toHaveBeenCalledWith({ where: { reviewId: 'g1' }, data: { moderationState: 'REJECTED', policyViolation: 'Contact info', reviewReplyUrl: 'https://g.page/r' } });
  });
});

describe('saveReply metadata', () => {
  it('persists holdReason and Google moderation metadata', async () => {
    await saveReply({ reviewId: 'g1', restaurantId: 'rest1', text: 't', state: 'POSTED' as any, source: 'AUTO' as any, holdReason: null, meta: { moderationState: 'PENDING', policyViolation: null, reviewReplyUrl: 'u' } });
    expect(db.reviewReply.upsert.mock.calls[0][0].create).toMatchObject({ moderationState: 'PENDING', reviewReplyUrl: 'u', holdReason: null });
  });
});

describe('listReviewsForAdmin pagination + search', () => {
  it('returns nextCursor when there are more rows and uses cursor/skip', async () => {
    db.googleReview.findMany.mockResolvedValue(Array.from({ length: ADMIN_PAGE_SIZE + 1 }, (_, i) => ({ id: `r${i}` })));
    const out = await listReviewsForAdmin('rest1', { cursor: 'c1' });
    expect(out.items).toHaveLength(ADMIN_PAGE_SIZE);
    expect(out.nextCursor).toBe(`r${ADMIN_PAGE_SIZE - 1}`);
    const arg = db.googleReview.findMany.mock.calls[0][0];
    expect(arg.cursor).toEqual({ id: 'c1' });
    expect(arg.skip).toBe(1);
    expect(arg.take).toBe(ADMIN_PAGE_SIZE + 1);
  });
  it('null cursor on the last page', async () => {
    db.googleReview.findMany.mockResolvedValue([{ id: 'a' }]);
    expect((await listReviewsForAdmin('rest1')).nextCursor).toBeNull();
  });
  it('searches comment and reviewer name case-insensitively and filters overdue, always tenant-scoped', async () => {
    db.googleReview.findMany.mockResolvedValue([]);
    await listReviewsForAdmin('rest1', { q: ' cold ', overdueSlaHours: 24 });
    const where = db.googleReview.findMany.mock.calls[0][0].where;
    expect(where.restaurantId).toBe('rest1');
    expect(where.AND[0].OR).toEqual([{ comment: { contains: 'cold', mode: 'insensitive' } }, { reviewerName: { contains: 'cold', mode: 'insensitive' } }]);
    expect(where.AND[1].source).toBe('gbp');
  });
});

describe('overdueWhere', () => {
  it('selects gbp reviews older than the SLA without a POSTED reply', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    const w: any = overdueWhere(24, now);
    expect(w.source).toBe('gbp');
    expect(w.reviewCreatedAt.lt).toEqual(new Date('2026-10-23T12:00:00Z'));
    expect(w.OR).toEqual([{ reply: { is: null } }, { reply: { state: { not: 'POSTED' } } }]);
  });
});

describe('response settings + stats + voice input', () => {
  it('returns defaults when the restaurant never saved settings', async () => {
    db.reviewResponseSettings.findUnique.mockResolvedValue(null);
    const s = await getResponseSettings('rest1');
    expect(s.slaHours).toBe(24);
    expect(s.alertMaxRating).toBe(2);
    expect(s.skipKeywords).toContain('food poisoning');
  });
  it('saveGoogleStats upserts totals and skips when Google sent none', async () => {
    await saveGoogleStats('rest1', { averageRating: null, totalReviewCount: null });
    expect(db.reviewResponseSettings.upsert).not.toHaveBeenCalled();
    await saveGoogleStats('rest1', { averageRating: 4.2, totalReviewCount: 99 });
    expect(db.reviewResponseSettings.upsert.mock.calls[0][0].update).toMatchObject({ googleAverageRating: 4.2, googleTotalReviewCount: 99 });
  });
  it('recentPostedReplies reads the last 20 POSTED replies for this tenant', async () => {
    db.reviewReply.findMany.mockResolvedValue([{ text: 'a' }, { text: 'b' }]);
    expect(await recentPostedReplies('rest1')).toEqual(['a', 'b']);
    expect(db.reviewReply.findMany.mock.calls[0][0]).toMatchObject({ where: { restaurantId: 'rest1', state: 'POSTED' }, take: 20 });
  });
});
