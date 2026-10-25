import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/server/integrations', () => ({ getConfig: vi.fn(), saveConfig: vi.fn() }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
import { discoverAccountAndLocation } from '@/server/reviews/google-business';

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://x/cb';
});

const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b, text: async () => '' }) as any;

describe('discoverAccountAndLocation', () => {
  it('parses first account and location', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(async (u: any) => {
      const url = String(u);
      const host = new URL(url).hostname;
      if (host === 'oauth2.googleapis.com') return json({ access_token: 'at' });
      if (host === 'mybusinessaccountmanagement.googleapis.com') return json({ accounts: [{ name: 'accounts/123' }, { name: 'accounts/9' }] });
      if (host === 'mybusinessbusinessinformation.googleapis.com') return json({ locations: [{ name: 'locations/456' }] });
      throw new Error('unexpected ' + url);
    });
    const r = await discoverAccountAndLocation('rt');
    expect(r).toEqual({ accountId: 'accounts/123', locationId: 'locations/456' });
    expect(f.mock.calls.some((c) => String(c[0]).includes('/v1/accounts/123/locations?readMask=name'))).toBe(true);
  });

  it('returns empty ids when no accounts', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (u: any) =>
      new URL(String(u)).hostname === 'oauth2.googleapis.com' ? json({ access_token: 'at' }) : json({}));
    expect(await discoverAccountAndLocation('rt')).toEqual({ accountId: '', locationId: '' });
  });
});
