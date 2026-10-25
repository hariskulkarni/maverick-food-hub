import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('@/server/integrations', () => ({ getConfig: getConfigMock, saveConfig: vi.fn() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  getOAuthUrl, listReviews, fetchReviews, postReply, GOOGLE_SCOPE, GoogleApiError, safeErrorMessage, normalizeGbpReview, MAX_REVIEW_PAGES,
} from '@/server/reviews/google-business';

beforeEach(() => {
  vi.clearAllMocks(); vi.restoreAllMocks();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://flavrly.in/api/admin/integrations/google-business/callback';
  getConfigMock.mockResolvedValue({ refreshToken: 'rt', accountId: 'accounts/1', locationId: 'locations/2' });
});

describe('getOAuthUrl', () => {
  it('includes scope, client id, offline access, and state', () => {
    const url = getOAuthUrl('st8');
    expect(url).toContain('scope=' + encodeURIComponent(GOOGLE_SCOPE));
    expect(url).toContain('client_id=cid');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('state=st8');
  });
});

describe('listReviews', () => {
  it('maps STAR enum to int and returns normalized reviews', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ reviews: [{
        name: 'accounts/1/locations/2/reviews/9', reviewer: { displayName: 'Asha' },
        starRating: 'FIVE', comment: 'Loved it', createTime: '2026-10-18T10:00:00Z',
      }] }), { status: 200 }));
    const out = await listReviews('r1');
    expect(out).toEqual([{
      googleReviewId: 'accounts/1/locations/2/reviews/9', reviewerName: 'Asha',
      rating: 5, comment: 'Loved it', reviewCreatedAt: new Date('2026-10-18T10:00:00Z'),
      reviewUpdatedAt: null, media: [], existingReply: null,
    }]);
    expect(String(fetchSpy.mock.calls[1][0])).toContain('/accounts/1/locations/2/reviews');
  });

  it('throws when accountId is missing from config', async () => {
    getConfigMock.mockResolvedValue({ refreshToken: 'rt', locationId: 'locations/2' });
    await expect(listReviews('r1')).rejects.toThrow('Google Business not connected');
  });

  it('throws when the refresh response has no access_token', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ expires_in: 3600 }), { status: 200 }));
    await expect(listReviews('r1')).rejects.toThrow('google refresh: no access_token in response');
  });
});

describe('postReply', () => {
  it('does not require accountId in config (PUTs using the review resource name)', async () => {
    getConfigMock.mockResolvedValue({ refreshToken: 'rt', locationId: 'locations/2' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comment: 'thanks' }), { status: 200 }));
    await postReply('r1', 'accounts/1/locations/2/reviews/9', 'Thank you!');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[1];
    expect(String(url)).toContain('/accounts/1/locations/2/reviews/9/reply');
    expect(init?.method).toBe('PUT');
  });

  it('PUTs the reply to the review resource', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ comment: 'thanks' }), { status: 200 }));
    await postReply('r1', 'accounts/1/locations/2/reviews/9', 'Thank you!');
    const [url, init] = fetchSpy.mock.calls[1];
    expect(String(url)).toContain('/accounts/1/locations/2/reviews/9/reply');
    expect(init?.method).toBe('PUT');
  });
});

const tok = () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });
const page = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('fetchReviews pagination + totals', () => {
  it('follows nextPageToken across pages and returns Google location totals', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tok())
      .mockResolvedValueOnce(page({ reviews: [{ name: 'r/1', starRating: 'FOUR', createTime: '2026-10-01T00:00:00Z' }], nextPageToken: 'p2', averageRating: 4.3, totalReviewCount: 120 }))
      .mockResolvedValueOnce(page({ reviews: [{ name: 'r/2', starRating: 'ONE', createTime: '2026-10-02T00:00:00Z' }] }));
    const out = await fetchReviews('r1');
    expect(out.reviews.map((r) => r.googleReviewId)).toEqual(['r/1', 'r/2']);
    expect(out.averageRating).toBe(4.3);
    expect(out.totalReviewCount).toBe(120);
    expect(String(spy.mock.calls[2][0])).toContain('pageToken=p2');
    expect(String(spy.mock.calls[1][0])).not.toContain('pageToken');
  });

  it('stops at MAX_REVIEW_PAGES even if Google keeps returning a token', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('oauth2') ? tok() : page({ reviews: [], nextPageToken: 'again' }));
    await fetchReviews('r1');
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('/reviews')).length).toBe(MAX_REVIEW_PAGES);
  });

  it('throws GoogleApiError with an owner-safe message on HTTP errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tok()).mockResolvedValueOnce(new Response('{"error":"secret detail"}', { status: 403 }));
    const err = await fetchReviews('r1').catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.status).toBe(403);
    expect(safeErrorMessage(err)).toBe('Google denied access. Reconnect Google Business in Settings.');
    expect(safeErrorMessage(err)).not.toContain('secret');
  });
});

describe('normalizeGbpReview (2026 fields)', () => {
  it('extracts an existing reply with moderation state, policy violation and reply URL', () => {
    const n = normalizeGbpReview({
      name: 'r/9', starRating: 'TWO', createTime: '2026-10-01T00:00:00Z', updateTime: '2026-10-03T00:00:00Z',
      reviewReply: { comment: 'Sorry!', updateTime: '2026-10-04T00:00:00Z', moderationState: 'REJECTED', policyViolation: { description: 'Contains contact info' }, reviewReplyUrl: 'https://g.page/r/abc' },
      reviewMedia: [{ googleUrl: 'https://lh3.googleusercontent.com/p.jpg', thumbnailUrl: 'https://lh3.googleusercontent.com/t.jpg', mediaFormat: 'PHOTO' }, { googleUrl: 'javascript:alert(1)' }],
    });
    expect(n.reviewUpdatedAt).toEqual(new Date('2026-10-03T00:00:00Z'));
    expect(n.existingReply).toEqual({
      comment: 'Sorry!', updateTime: new Date('2026-10-04T00:00:00Z'),
      moderationState: 'REJECTED', policyViolation: 'Contains contact info', reviewReplyUrl: 'https://g.page/r/abc',
    });
    expect(n.media).toEqual([{ url: 'https://lh3.googleusercontent.com/p.jpg', thumbnailUrl: 'https://lh3.googleusercontent.com/t.jpg', type: 'PHOTO' }]);
  });

  it('treats an empty reply comment as no reply', () => {
    expect(normalizeGbpReview({ name: 'r/1', starRating: 'FIVE', reviewReply: { comment: '  ' } }).existingReply).toBeNull();
  });
});

describe('postReply result + errors', () => {
  it('returns the reply moderation metadata Google sends back', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tok())
      .mockResolvedValueOnce(page({ comment: 'Thanks', moderationState: 'PENDING', reviewReplyUrl: 'https://g.page/x' }));
    expect(await postReply('r1', 'accounts/1/locations/2/reviews/9', 'Thanks')).toEqual({
      moderationState: 'PENDING', policyViolation: null, reviewReplyUrl: 'https://g.page/x',
    });
  });

  it('throws GoogleApiError on a rejected PUT', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(tok()).mockResolvedValueOnce(new Response('bad', { status: 429 }));
    const err = await postReply('r1', 'x', 'y').catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err.safeMessage).toMatch(/rate limit/);
  });
});

describe('fetchReviews incremental', () => {
  it('stops paging once a page ends before stopBefore', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tok())
      .mockResolvedValueOnce(page({ reviews: [{ name: 'r/1', starRating: 'FIVE', createTime: '2026-01-01T00:00:00Z', updateTime: '2026-01-02T00:00:00Z' }], nextPageToken: 'p2' }));
    const out = await fetchReviews('r1', { stopBefore: new Date('2026-06-01T00:00:00Z') });
    expect(out.reviews).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('keeps paging while reviews are newer than stopBefore', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(tok())
      .mockResolvedValueOnce(page({ reviews: [{ name: 'r/1', starRating: 'FIVE', createTime: '2026-10-20T00:00:00Z' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(page({ reviews: [{ name: 'r/2', starRating: 'FIVE', createTime: '2026-10-19T00:00:00Z' }] }));
    const out = await fetchReviews('r1', { stopBefore: new Date('2026-10-01T00:00:00Z') });
    expect(out.reviews).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
