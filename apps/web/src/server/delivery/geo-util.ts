/**
 * Pure geo helpers for delivery zones. No I/O.
 */

/**
 * Ray-casting point-in-polygon. Ring points are [lng, lat]. The ring may be
 * open or closed (first point repeated as last); both behave identically.
 *
 * Boundary convention (deterministic, half-open): a point on the left or
 * bottom boundary is INSIDE, a point on the right or top boundary is OUTSIDE.
 * Vertices follow the same rule. Rings with fewer than 3 distinct points
 * contain nothing.
 */
export function pointInPolygon(
  lng: number,
  lat: number,
  ring: [number, number][],
): boolean {
  let pts = ring;
  if (
    pts.length > 1 &&
    pts[0][0] === pts[pts.length - 1][0] &&
    pts[0][1] === pts[pts.length - 1][1]
  ) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return false;

  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres between two lat/lng points. */
export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
