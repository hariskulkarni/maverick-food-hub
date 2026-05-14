/**
 * Proximity helper — distance math + debounced "rider:nearby" broadcast.
 *
 * Lives outside `realtime.ts` so the bus stays a pure transport layer and the
 * business rule ("emit `rider:nearby` when within 200m, no more than once per
 * 5 minutes per order") has a single home.
 *
 * The debounce map is in-process and survives across requests within the same
 * Node worker. Multi-instance deploys should back this with Redis (key
 * `proximity:nearby:{orderId}`, EX 300) — see `/api/rider/location/route.ts`
 * for the call site.
 */
import { publish, type RealtimeEvent } from './realtime';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Haversine distance between two points, in metres. Uses the equirectangular
 * earth-radius approximation (6371 km) — accurate to ~0.5% for delivery-scale
 * distances and several orders of magnitude faster than Vincenty.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000; // metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Threshold + dedupe window. Pulled out as constants so tests can stub them.
export const NEARBY_THRESHOLD_M = 200;
export const NEARBY_DEDUPE_MS = 5 * 60 * 1_000;

declare global {
  // eslint-disable-next-line no-var
  var __nearbyLastAt: Map<string, number> | undefined;
}

const lastNearbyAt: Map<string, number> =
  global.__nearbyLastAt ?? new Map<string, number>();
if (process.env.NODE_ENV !== 'production') global.__nearbyLastAt = lastNearbyAt;

/**
 * Compute distance from rider → drop. If under threshold AND we haven't fired
 * a `rider:nearby` for this order in the last `NEARBY_DEDUPE_MS`, publish to
 * `order:{orderId}` and remember the timestamp.
 *
 * Returns the computed distance in metres (or null if either coordinate was
 * missing) so callers can attach it to other event payloads if they like.
 */
export function maybePublishNearby(
  orderId: string,
  rider: LatLng,
  drop: LatLng | null | undefined,
  now: number = Date.now()
): number | null {
  if (!drop || typeof drop.lat !== 'number' || typeof drop.lng !== 'number') return null;
  const distanceM = haversineMeters(rider, drop);
  if (distanceM > NEARBY_THRESHOLD_M) return distanceM;

  const last = lastNearbyAt.get(orderId) ?? 0;
  if (now - last < NEARBY_DEDUPE_MS) return distanceM;
  lastNearbyAt.set(orderId, now);

  const event: RealtimeEvent = {
    kind: 'rider:nearby',
    orderId,
    distanceM: Math.round(distanceM),
    at: new Date(now).toISOString()
  };
  publish(`order:${orderId}`, event);
  return distanceM;
}
