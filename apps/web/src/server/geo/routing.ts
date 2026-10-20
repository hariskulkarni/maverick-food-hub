import { haversineKm } from '@/lib/utils';

export type LatLng = { lat: number; lng: number };
export type RouteResult = { distanceKm: number; durationMin: number; polyline?: string };

/** Heuristic urban travel time when no routing engine is configured: ~2 min per km (~30 km/h). */
export const HAVERSINE_MIN_PER_KM = 2;
const OSRM_TIMEOUT_MS = 3000;

function haversineRoute(from: LatLng, to: LatLng): RouteResult {
  const distanceKm = haversineKm(from, to);
  return { distanceKm, durationMin: distanceKm * HAVERSINE_MIN_PER_KM };
}

async function osrmRoute(base: string, from: LatLng, to: LatLng): Promise<RouteResult> {
  const url = `${base.replace(/\/+$/, '')}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline`;
  const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const body = (await res.json()) as {
    routes?: { distance?: number; duration?: number; geometry?: string }[];
  };
  const r = body.routes?.[0];
  if (!r || typeof r.distance !== 'number' || typeof r.duration !== 'number') {
    throw new Error('OSRM: no route');
  }
  return {
    distanceKm: r.distance / 1000,
    durationMin: r.duration / 60,
    ...(typeof r.geometry === 'string' && r.geometry ? { polyline: r.geometry } : {})
  };
}

/**
 * Road distance/duration between two points. Uses OSRM when OSRM_URL is set,
 * otherwise (or on any OSRM failure/timeout) falls back to haversine. Never throws.
 */
export async function routeDistance(from: LatLng, to: LatLng): Promise<RouteResult> {
  const base = process.env.OSRM_URL;
  if (!base) return haversineRoute(from, to);
  try {
    return await osrmRoute(base, from, to);
  } catch {
    return haversineRoute(from, to);
  }
}
