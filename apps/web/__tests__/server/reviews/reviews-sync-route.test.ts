import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(),
  listReviews: vi.fn(),
  upsertReview: vi.fn(),
  syncGoogleReply: vi.fn(),
  saveGoogleStats: vi.fn(),
  invalidateAnalysis: vi.fn(),
  auditReview: vi.fn(),
}));

vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
// listReviews is the test-facing alias for the reviews fetchReviews returns.
vi.mock('@/server/reviews/google-business', () => ({
  fetchReviews: async (id: string) => ({ reviews: await h.listReviews(id), averageRating: 4.5, totalReviewCount: 10 }),
  safeErrorMessage: (e: Error) => (/not connected/i.test(e.message) ? 'Google Business not connected' : 'Google is unavailable right now. Try again later.'),
}));
vi.mock('@/server/reviews/store', () => ({ upsertReview: h.upsertReview, syncGoogleReply: h.syncGoogleReply, saveGoogleStats: h.saveGoogleStats }));
vi.mock('@/server/reviews/insights', () => ({ invalidateAnalysis: h.invalidateAnalysis }));
vi.mock('@/server/reviews/review-audit', () => ({ auditReview: h.auditReview }));


import { POST } from '@/app/api/admin/reviews/sync/route';

const req = () => ({ nextUrl: new URL('http://x/api/admin/reviews/sync') }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
  h.saveGoogleStats.mockResolvedValue(undefined);
});

describe('POST /api/admin/reviews/sync', () => {
  it('syncs reviews and reports created count', async () => {
    const reviews = [{ googleReviewId: 'a' }, { googleReviewId: 'b' }];
    h.listReviews.mockResolvedValue(reviews);
    h.upsertReview.mockResolvedValueOnce({ isNew: true }).mockResolvedValueOnce({ isNew: false });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, synced: 2, created: 1, failed: 0, repliesImported: 0 });
    expect(h.listReviews).toHaveBeenCalledWith('rest1');
    expect(h.upsertReview).toHaveBeenCalledTimes(2);
    expect(h.upsertReview).toHaveBeenNthCalledWith(1, 'rest1', reviews[0]);
    expect(h.upsertReview).toHaveBeenNthCalledWith(2, 'rest1', reviews[1]);
  });

  it('409 when Google Business is not connected', async () => {
    h.listReviews.mockRejectedValue(new Error('Google Business not connected'));
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Google Business not connected' });
    expect(h.upsertReview).not.toHaveBeenCalled();
  });

  it('502 on a generic Google failure', async () => {
    h.listReviews.mockRejectedValue(new Error('boom'));
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect(h.upsertReview).not.toHaveBeenCalled();
  });

  it('one failing row does not abort the sync', async () => {
    h.listReviews.mockResolvedValue([{ googleReviewId: 'a' }, { googleReviewId: 'b' }]);
    h.upsertReview.mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce({ isNew: true });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, synced: 1, created: 1, failed: 1, repliesImported: 0 });
  });

  it('imports replies already on Google, refreshes edited reviews, stores totals and audits', async () => {
    const existingReply = { comment: 'Thanks', updateTime: null, moderationState: null, policyViolation: null, reviewReplyUrl: null };
    h.listReviews.mockResolvedValue([{ googleReviewId: 'a', existingReply }, { googleReviewId: 'b' }]);
    h.upsertReview.mockResolvedValueOnce({ id: 'g1', isNew: true, edited: false }).mockResolvedValueOnce({ id: 'g2', isNew: false, edited: true });
    h.syncGoogleReply.mockResolvedValue(true);
    const res = await POST(req());
    expect(await res.json()).toEqual({ ok: true, synced: 2, created: 1, failed: 0, repliesImported: 1 });
    expect(h.syncGoogleReply).toHaveBeenCalledWith('g1', 'rest1', existingReply);
    expect(h.invalidateAnalysis).toHaveBeenCalledWith('g2');
    expect(h.saveGoogleStats).toHaveBeenCalledWith('rest1', expect.objectContaining({ averageRating: 4.5, totalReviewCount: 10 }));
    expect(h.auditReview).toHaveBeenCalledWith('reviews.sync', 'rest1', expect.objectContaining({ after: expect.objectContaining({ created: 1 }) }));
  });

  it('502 message is owner-safe (no upstream body)', async () => {
    h.listReviews.mockRejectedValue(new Error('google reviews 500: {"secret":"x"}'));
    const res = await POST(req());
    expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});
