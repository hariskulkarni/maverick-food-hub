import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));
vi.mock('@/server/integrations', () => ({ getConfig: getConfigMock, saveConfig: vi.fn() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getOAuthUrl, listReviews, postReply, GOOGLE_SCOPE } from '@/server/reviews/google-business';

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
