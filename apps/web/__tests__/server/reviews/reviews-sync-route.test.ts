import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  requireManagedRestaurant: vi.fn(),
  listReviews: vi.fn(),
  upsertReview: vi.fn(),
}));

vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: h.requireManagedRestaurant }));
vi.mock('@/server/reviews/google-business', () => ({ listReviews: h.listReviews }));
vi.mock('@/server/reviews/store', () => ({ upsertReview: h.upsertReview }));

import { POST } from '@/app/api/admin/reviews/sync/route';

const req = () => ({ nextUrl: new URL('http://x/api/admin/reviews/sync') }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  h.requireManagedRestaurant.mockResolvedValue({ id: 'rest1' });
});

describe('POST /api/admin/reviews/sync', () => {
  it('syncs reviews and reports created count', async () => {
    const reviews = [{ googleReviewId: 'a' }, { googleReviewId: 'b' }];
    h.listReviews.mockResolvedValue(reviews);
    h.upsertReview.mockResolvedValueOnce({ isNew: true }).mockResolvedValueOnce({ isNew: false });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, synced: 2, created: 1 });
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
});
