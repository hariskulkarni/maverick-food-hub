import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { routeDistance } from '@/server/geo/routing';
import { haversineKm } from '@/lib/utils';

const from = { lat: 12.9716, lng: 77.5946 };
const to = { lat: 12.9352, lng: 77.6245 };

describe('routeDistance', () => {
  const origUrl = process.env.OSRM_URL;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    if (origUrl === undefined) delete process.env.OSRM_URL;
    else process.env.OSRM_URL = origUrl;
  });

  it('without OSRM_URL uses haversine + heuristic duration, no polyline', async () => {
    delete process.env.OSRM_URL;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await routeDistance(from, to);
    expect(r.distanceKm).toBeCloseTo(haversineKm(from, to), 5);
    expect(r.durationMin).toBeCloseTo(haversineKm(from, to) * 2, 5);
    expect(r.polyline).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with OSRM_URL parses distance, duration and geometry', async () => {
    process.env.OSRM_URL = 'http://osrm.test';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ code: 'Ok', routes: [{ distance: 5400, duration: 780, geometry: '_p~iF~ps|U' }] }),
        { status: 200 }
      )
    );
    const r = await routeDistance(from, to);
    expect(r).toEqual({ distanceKm: 5.4, durationMin: 13, polyline: '_p~iF~ps|U' });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(
      'http://osrm.test/route/v1/driving/77.5946,12.9716;77.6245,12.9352?overview=full&geometries=polyline'
    );
  });

  it.each([
    ['network error', () => vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))],
    ['http 500', () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('x', { status: 500 }))],
    [
      'no routes',
      () => vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ code: 'NoRoute', routes: [] }), { status: 200 }))
    ]
  ])('falls back to haversine on %s and never throws', async (_n, setup) => {
    process.env.OSRM_URL = 'http://osrm.test';
    setup();
    const r = await routeDistance(from, to);
    expect(r.distanceKm).toBeCloseTo(haversineKm(from, to), 5);
    expect(r.polyline).toBeUndefined();
  });
});
