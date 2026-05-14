/**
 * Pure geo helpers — zero dependencies.
 *
 * Used by the active-delivery screen to show an on-screen distance + ETA
 * readout from the rider's live position to the next waypoint.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance between two coordinates, in kilometres.
 * Straight-line ("as the crow flies") — good enough for an ETA estimate.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Assumed average urban delivery speed, in km/h. */
const AVG_SPEED_KMH = 20;

/**
 * Rough ETA in whole minutes for a given straight-line distance, assuming
 * ~20 km/h average urban delivery speed. Always at least 1 minute when there
 * is any distance to cover, so the readout never shows "~0 min".
 */
export function estimateEtaMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
  const minutes = (distanceKm / AVG_SPEED_KMH) * 60;
  return Math.max(1, Math.round(minutes));
}
