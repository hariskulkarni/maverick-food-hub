/**
 * ETA helper — pure functions for predicting arrival from a current
 * position to a destination. Uses haversine distance / assumed cruise
 * speed; intentionally simple because actual routing (traffic, turn
 * restrictions) isn't worth the latency for an ops dashboard.
 *
 *   computeEta({ lat, lng }, { lat, lng })             → minutes
 *   computeEta(from, to, 30 /* kph * /)                → minutes
 *   formatEta(8.3)                                     → '~8 min'
 */

import { haversineKm } from '@/lib/utils';

export const DEFAULT_RIDER_SPEED_KPH = 25;

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Returns predicted travel time in minutes between two coordinates,
 * assuming `speedKph` (default 25 km/h — the urban scooter rule of thumb).
 * Returns `null` if either coordinate is incomplete.
 */
export function computeEta(
  from: LatLng | null | undefined,
  to: LatLng | null | undefined,
  speedKph: number = DEFAULT_RIDER_SPEED_KPH
): number | null {
  if (!from || !to) return null;
  if (typeof from.lat !== 'number' || typeof from.lng !== 'number') return null;
  if (typeof to.lat !== 'number' || typeof to.lng !== 'number') return null;
  if (speedKph <= 0) return null;
  const km = haversineKm(from, to);
  const hours = km / speedKph;
  return hours * 60;
}

/** Format minutes as "~N min" (rounded, min 1). Returns "—" if null. */
export function formatEta(minutes: number | null | undefined): string {
  if (minutes == null || !isFinite(minutes)) return '—';
  const n = Math.max(1, Math.round(minutes));
  return `~${n} min`;
}
