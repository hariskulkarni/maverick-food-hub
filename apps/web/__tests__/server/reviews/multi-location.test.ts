import { describe, it, expect, vi, beforeEach } from 'vitest';

const { reqRestMock, getConfigMock, saveMock } = vi.hoisted(() => ({
  reqRestMock: vi.fn(), getConfigMock: vi.fn(), saveMock: vi.fn(),
}));
vi.mock('@/server/tenancy', () => ({ requireManagedRestaurant: reqRestMock }));
vi.mock('@/server/integrations', () => ({ getConfig: getConfigMock, saveConfig: saveMock }));
vi.mock('@/server/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { NextRequest } from 'next/server';
import { listAllLocations } from '@/server/reviews/google-business';
import { POST } from '@/app/api/admin/integrations/google-business/select-location/route';

const post = (body: unknown) =>
  new NextRequest('https://flavrly.in/api/admin/integrations/google-business/select-location', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

const locs = [{ id: 'locations/1', title: 'Indiranagar' }, { id: 'locations/2', title: 'Koramangala' }];

beforeEach(() => {
  vi.clearAllMocks(); vi.restoreAllMocks();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'cid';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'csecret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://flavrly.in/cb';
  reqRestMock.mockResolvedValue({ id: 'rest1' });
});

describe('listAllLocations', () => {
  it('parses multiple locations', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ locations: [
        { name: 'locations/1', title: 'Indiranagar' },
        { name: 'locations/2', displayName: 'Koramangala' },
        { name: 'locations/3' },
      ] }), { status: 200 }));
    const out = await listAllLocations('rt', 'accounts/9');
    expect(out).toEqual([
      { id: 'locations/1', title: 'Indiranagar' },
      { id: 'locations/2', title: 'Koramangala' },
      { id: 'locations/3', title: 'locations/3' },
    ]);
    expect(String(spy.mock.calls[1][0])).toContain('/accounts/9/locations?readMask=');
  });
});

describe('select-location route', () => {
  it('saves merged config for a listed location', async () => {
    getConfigMock.mockResolvedValue({ refreshToken: 'rt', accountId: 'accounts/9', locationId: '', locations: JSON.stringify(locs) });
    const res = await POST(post({ locationId: 'locations/2' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(saveMock).toHaveBeenCalledWith('rest1', 'GOOGLE_BUSINESS',
      { refreshToken: 'rt', accountId: 'accounts/9', locationId: 'locations/2', locations: JSON.stringify(locs) },
      { status: 'CONNECTED' });
  });

  it('400s for a location not in the list', async () => {
    getConfigMock.mockResolvedValue({ refreshToken: 'rt', locations: JSON.stringify(locs) });
    const res = await POST(post({ locationId: 'locations/evil' }));
    expect(res.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('409s when not connected', async () => {
    getConfigMock.mockResolvedValue(null);
    const res = await POST(post({ locationId: 'locations/1' }));
    expect(res.status).toBe(409);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
