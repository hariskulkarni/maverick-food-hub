/**
 * Pure server-side spoofing heuristics for rider location pings — anti-fraud on
 * OPERATIONAL location data only (never anything about the rider's personal
 * phone use). Given the rider's previous fix and the newly accepted points,
 * return the suspicion signals the ping(s) raised. The mocked-GPS flag is
 * handled by the caller (service.ts); this module only reasons about movement,
 * coordinates, reported accuracy and the device clock.
 *
 * Kept pure (no I/O) so each heuristic is unit-tested in isolation.
 */

/** One point as the heuristics see it. `t` is the (clock-corrected) fix time, ms epoch. */
export interface SpoofPoint {
  lat: number;
  lng: number;
  /** Fix time, ms epoch. */
  t: number;
  /** Reported horizontal accuracy in metres, when the app sent it. */
  accuracy?: number;
}

export type SpoofKind =
  | 'TELEPORT'
  | 'IMPOSSIBLE_SPEED'
  | 'REPEAT_COORD'
  | 'ROUND_ACCURACY'
  | 'FROZEN'
  | 'CLOCK_SKEW';

export interface SpoofSignal {
  kind: SpoofKind;
  /** Suspicion weight this signal contributes to the shift score. */
  score: number;
  /** Human-readable detail for the ops review queue. */
  reason: string;
  /** The offending fix, when the signal is tied to a point. */
  lat?: number;
  lng?: number;
  at?: number;
}

export const SPOOF_SCORE: Record<SpoofKind, number> = {
  TELEPORT: 40,
  IMPOSSIBLE_SPEED: 30,
  REPEAT_COORD: 20,
  FROZEN: 20,
  ROUND_ACCURACY: 10,
  CLOCK_SKEW: 15,
};

/** Score a mocked ping contributes (used by the caller). */
export const MOCK_SCORE = 50;

// Thresholds — deliberately conservative so honest GPS jitter never trips them.
export const TELEPORT_DIST_M = 2000;
export const TELEPORT_WINDOW_MS = 30_000;
/** Sustained ground speed above this (km/h) between two real fixes is impossible for a bike/car in city traffic. */
export const IMPOSSIBLE_SPEED_KPH = 120;
/** A segment must be at least this long for a speed reading to be trusted (ignores jitter over a tiny gap). */
export const SPEED_MIN_SEGMENT_M = 150;
/** How many identical coordinates (incl. the previous fix) count as "repeated". */
export const REPEAT_COORD_MIN = 4;
/** No movement at all over at least this long while pings keep arriving → frozen. */
export const FROZEN_WINDOW_MS = 120_000;
/** Device clock vs. server clock drift beyond this suggests timestamp manipulation. */
export const CLOCK_SKEW_MS = 120_000;
/** Accuracy values that are suspiciously round (a real sensor almost never reports an exact multiple of these repeatedly). */
export const ROUND_ACCURACY_MIN = 4;

const EARTH_R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Haversine distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const sameCoord = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  a.lat === b.lat && a.lng === b.lng;

/** An accuracy that is an exact whole-metre multiple of 5 (5, 10, 15, …) is "round". */
export function isRoundAccuracy(acc: number): boolean {
  return acc > 0 && Number.isInteger(acc) && acc % 5 === 0;
}

/**
 * Evaluate the new points against the rider's previous fix. `prev` is the last
 * trusted position (RiderProfile.current* + its fix time) or null on the first
 * fix of a shift. `points` are the newly accepted, non-mocked fixes, oldest
 * first. `driftMs` is (serverNow - sentAt) reported by the device, used to
 * detect a manipulated device clock.
 */
export function evaluateSpoof(input: {
  prev: SpoofPoint | null;
  points: SpoofPoint[];
  driftMs?: number;
}): SpoofSignal[] {
  const { prev, points, driftMs } = input;
  const signals: SpoofSignal[] = [];
  if (points.length === 0) return signals;

  // Segment-based: teleport + impossible speed across [prev, ...points].
  const chain = prev ? [prev, ...points] : points;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    const dt = b.t - a.t;
    if (dt <= 0) continue; // out-of-order guard; ordering is the caller's job
    const dist = distanceM(a, b);

    if (dist >= TELEPORT_DIST_M && dt < TELEPORT_WINDOW_MS) {
      signals.push({
        kind: 'TELEPORT',
        score: SPOOF_SCORE.TELEPORT,
        reason: `Jumped ${Math.round(dist)} m in ${(dt / 1000).toFixed(1)} s`,
        lat: b.lat,
        lng: b.lng,
        at: b.t,
      });
      continue; // a teleport already dominates this segment; don't double-count as speed
    }

    if (dist >= SPEED_MIN_SEGMENT_M) {
      const kph = (dist / dt) * 3600;
      if (kph > IMPOSSIBLE_SPEED_KPH) {
        signals.push({
          kind: 'IMPOSSIBLE_SPEED',
          score: SPOOF_SCORE.IMPOSSIBLE_SPEED,
          reason: `Sustained ${Math.round(kph)} km/h over ${Math.round(dist)} m`,
          lat: b.lat,
          lng: b.lng,
          at: b.t,
        });
      }
    }
  }

  // Repeated identical coordinates (incl. the previous fix).
  const repeatCount = chain.filter((p) => sameCoord(p, chain[chain.length - 1])).length;
  if (chain.length >= REPEAT_COORD_MIN && repeatCount >= REPEAT_COORD_MIN) {
    const last = chain[chain.length - 1];
    signals.push({
      kind: 'REPEAT_COORD',
      score: SPOOF_SCORE.REPEAT_COORD,
      reason: `${repeatCount} pings at the exact same coordinate`,
      lat: last.lat,
      lng: last.lng,
      at: last.t,
    });
  }

  // Frozen: no movement at all across the whole chain over a meaningful window.
  if (chain.length >= 2) {
    const first = chain[0];
    const last = chain[chain.length - 1];
    const span = last.t - first.t;
    const moved = chain.some((p) => !sameCoord(p, first));
    if (!moved && span >= FROZEN_WINDOW_MS) {
      signals.push({
        kind: 'FROZEN',
        score: SPOOF_SCORE.FROZEN,
        reason: `Position frozen for ${Math.round(span / 1000)} s while pings kept arriving`,
        lat: last.lat,
        lng: last.lng,
        at: last.t,
      });
    }
  }

  // Suspiciously round accuracy, repeated.
  const roundAcc = points.filter((p) => p.accuracy !== undefined && isRoundAccuracy(p.accuracy));
  if (roundAcc.length >= ROUND_ACCURACY_MIN) {
    const last = roundAcc[roundAcc.length - 1];
    signals.push({
      kind: 'ROUND_ACCURACY',
      score: SPOOF_SCORE.ROUND_ACCURACY,
      reason: `${roundAcc.length} pings reported an exact-round accuracy (${last.accuracy} m)`,
      lat: last.lat,
      lng: last.lng,
      at: last.t,
    });
  }

  // Device-clock manipulation.
  if (driftMs !== undefined && Math.abs(driftMs) > CLOCK_SKEW_MS) {
    signals.push({
      kind: 'CLOCK_SKEW',
      score: SPOOF_SCORE.CLOCK_SKEW,
      reason: `Device clock off by ${Math.round(Math.abs(driftMs) / 1000)} s from the server`,
    });
  }

  return signals;
}
