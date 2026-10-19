import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reqRestMock, exchangeMock, accountsMock, locsMock, saveMock } = vi.hoisted(() => ({
  reqRestMock: vi.fn(), exchangeMock: vi.fn(), accountsMock: vi.fn(), locsMock: vi.fn(), saveMock: vi.fn(),
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: reqRestMock }));
vi.mock('@/server/reviews/google-business', () => ({
  getOAuthUrl: (s: string) => `https://accounts.google.com/o/oauth2/v2/auth?state=${s}`,
  exchangeCode: exchangeMock,
  listAccounts: accountsMock,
  listAllLocations: locsMock,
}));
vi.mock('@/server/integrations', () => ({ saveConfig: saveMock }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { NextRequest } from 'next/server';
import { GET as connectGET } from '@/app/api/admin/integrations/google-business/connect/route';
import { signState } from '@/server/reviews/oauth-state';
import { GET as callbackGET } from '@/app/api/admin/integrations/google-business/callback/route';

const cb = (qs: string) =>
  new NextRequest(`https://flavrly.in/api/admin/integrations/google-business/callback?${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INTEGRATION_ENCRYPTION_KEY = 'test-key';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://flavrly.in/api/admin/integrations/google-business/callback';
  reqRestMock.mockResolvedValue({ id: 'rest1' });
  exchangeMock.mockResolvedValue({ refreshToken: 'rt-1' });
  accountsMock.mockResolvedValue('accounts/1');
  locsMock.mockResolvedValue([{ id: 'locations/2', title: 'Main' }]);
});

describe('connect', () => {
  it('redirects to Google with a state param', async () => {
    const res = await connectGET(new NextRequest('https://flavrly.in/api/admin/integrations/google-business/connect'));
    expect(res.status).toBe(302);
    const loc = res.headers.get('location')!;
    expect(loc).toContain('accounts.google.com');
    expect(new URL(loc).searchParams.get('state')).toBeTruthy();
  });
});

describe('callback', () => {
  it('403s and does not save when state is bound to another restaurant', async () => {
    const res = await callbackGET(cb(`code=abc&state=${signState('other-rest')}`));
    expect(res.status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('403s and does not save when mac is tampered', async () => {
    const [rid, nonce] = Buffer.from(signState('rest1'), 'base64url').toString().split(':');
    const bad = Buffer.from(`${rid}:${nonce}:${'0'.repeat(32)}`).toString('base64url');
    const res = await callbackGET(cb(`code=abc&state=${bad}`));
    expect(res.status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('403s when code is missing', async () => {
    const res = await callbackGET(cb(`state=${signState('rest1')}`));
    expect(res.status).toBe(403);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('saves scoped config and redirects on valid state', async () => {
    const res = await callbackGET(cb(`code=abc&state=${signState('rest1')}`));
    expect(exchangeMock).toHaveBeenCalledWith('abc');
    expect(saveMock).toHaveBeenCalledWith(
      'rest1', 'GOOGLE_BUSINESS',
      expect.objectContaining({ refreshToken: 'rt-1', accountId: 'accounts/1', locationId: 'locations/2' }),
      { status: 'CONNECTED' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/admin/settings?tab=reviews&google=connected');
  });

  it('flags needs_location when no location found, still saves', async () => {
    locsMock.mockResolvedValue([]);
    const res = await callbackGET(cb(`code=abc&state=${signState('rest1')}`));
    expect(saveMock).toHaveBeenCalledWith('rest1', 'GOOGLE_BUSINESS',
      expect.objectContaining({ refreshToken: 'rt-1' }), { status: 'CONNECTED' });
    expect(res.headers.get('location')).toContain('google=needs_location');
  });

  it('redirects to the picker when multiple locations, locationId empty', async () => {
    locsMock.mockResolvedValue([{ id: 'locations/1', title: 'A' }, { id: 'locations/2', title: 'B' }]);
    const res = await callbackGET(cb(`code=abc&state=${signState('rest1')}`));
    expect(saveMock).toHaveBeenCalledWith('rest1', 'GOOGLE_BUSINESS',
      expect.objectContaining({ locationId: '', locations: expect.stringContaining('locations/1') }), { status: 'CONNECTED' });
    expect(res.headers.get('location')).toContain('tab=reviews&pickLocation=1');
  });

  it('still saves the token when discovery throws', async () => {
    locsMock.mockRejectedValue(new Error('boom'));
    const res = await callbackGET(cb(`code=abc&state=${signState('rest1')}`));
    expect(saveMock).toHaveBeenCalledWith('rest1', 'GOOGLE_BUSINESS',
      expect.objectContaining({ refreshToken: 'rt-1', locationId: '', locations: '[]' }), { status: 'CONNECTED' });
    expect(res.headers.get('location')).toContain('google=needs_location');
  });
});
