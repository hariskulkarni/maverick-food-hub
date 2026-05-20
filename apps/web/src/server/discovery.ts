/**
 * Customer restaurant discovery — "show only restaurants near me".
 *
 * Filtering rule (strictest, per product): a restaurant is shown only when it
 * has a branch that is BOTH
 *   1. within the platform discovery radius of the customer's location, AND
 *   2. within that branch's own serviceRadiusKm (the restaurant delivers there).
 * i.e. effective reach for a branch = min(discoveryRadius, branch.serviceRadiusKm).
 *
 * The customer's location is held in a cookie (`delivery_location`) so it works
 * for guests and logged-in users alike; the value is set by /api/customer/location.
 *
 * The core filter is a PURE function (no prisma/cookies) so it's unit-testable.
 */

import { cookies } from 'next/headers';
import { haversineMeters, type LatLng } from './proximity';

export const LOCATION_COOKIE = 'delivery_location';

export interface DeliveryLocation {
  lat: number;
  lng: number;
  /** Human label shown in the "deliver to" header, e.g. a reverse-geocoded address. */
  label: string;
}

/** A branch as needed for the distance check. */
export interface BranchGeo {
  id: string;
  latitude: number | null;
  longitude: number | null;
  serviceRadiusKm: number;
}

export interface NearbyMatch<R> {
  restaurant: R;
  /** Distance to the nearest qualifying branch, in metres. */
  distanceM: number;
  /** The qualifying branch id (nearest deliverable branch). */
  branchId: string;
}

/**
 * Filter + rank restaurants by proximity to `loc`. A restaurant qualifies if
 * any of its branches is within BOTH the discovery radius and that branch's
 * serviceRadiusKm. Returns matches sorted nearest-first, each annotated with the
 * nearest qualifying branch + its distance.
 */
export function filterNearbyRestaurants<R extends { branches: BranchGeo[] }>(
  loc: LatLng,
  discoveryRadiusKm: number,
  restaurants: R[]
): NearbyMatch<R>[] {
  const discoveryM = discoveryRadiusKm * 1000;
  const matches: NearbyMatch<R>[] = [];

  for (const r of restaurants) {
    let best: { distanceM: number; branchId: string } | null = null;
    for (const b of r.branches) {
      if (b.latitude == null || b.longitude == null) continue;
      const d = haversineMeters(loc, { lat: b.latitude, lng: b.longitude });
      const branchReachM = b.serviceRadiusKm * 1000;
      // Strict: must be inside the platform radius AND the branch's own range.
      if (d > discoveryM || d > branchReachM) continue;
      if (!best || d < best.distanceM) best = { distanceM: d, branchId: b.id };
    }
    if (best) matches.push({ restaurant: r, distanceM: best.distanceM, branchId: best.branchId });
  }

  matches.sort((a, b) => a.distanceM - b.distanceM);
  return matches;
}

/** Read the customer's chosen delivery location from its cookie (server-side). */
export async function readDeliveryLocation(): Promise<DeliveryLocation | null> {
  try {
    const raw = (await cookies()).get(LOCATION_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeliveryLocation>;
    if (
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      Number.isFinite(parsed.lat) &&
      Number.isFinite(parsed.lng)
    ) {
      return { lat: parsed.lat, lng: parsed.lng, label: String(parsed.label ?? 'Selected location') };
    }
  } catch {
    /* malformed cookie → treat as no location */
  }
  return null;
}

/** Serialize a location for the Set-Cookie value (used by the location API). */
export function serializeDeliveryLocation(loc: DeliveryLocation): string {
  return JSON.stringify({ lat: loc.lat, lng: loc.lng, label: loc.label.slice(0, 160) });
}
