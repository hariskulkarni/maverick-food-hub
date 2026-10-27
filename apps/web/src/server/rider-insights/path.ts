/**
 * Path reconstruction from stored rider GPS pings (DeliveryLocationPing). Pure.
 *
 * Input pings are already filtered server-side on ingest (out-of-order,
 * duplicate, future and >6 h-stale fixes dropped; thinned to one per ~3 s —
 * see server/rider-location-points.ts). On top of that:
 *  - points are ordered by fix time;
 *  - a point implying an impossible speed from the last kept point
 *    (> MAX_SPEED_KPH — a GPS jump) is dropped as an outlier;
 *  - distance only accrues once the rider has moved ≥ JITTER_M from the last
 *    anchor, so a parked phone's GPS wander doesn't add kilometres;
 *  - a silence longer than BREAK_GAP_MS splits the path: no straight-line
 *    distance is invented across it (the rider was offline / phone dead);
 *  - silences longer than GAP_MS (the auto-offline window) are counted as gaps.
 */
import { haversineKm } from '@/lib/utils';

export const MAX_SPEED_KPH = 150;
export const JITTER_M = 15;
export const GAP_MS = 2 * 60_000;
export const BREAK_GAP_MS = 10 * 60_000;
/** Below this average speed a segment counts as standing still. */
export const MOVING_KPH = 3;

export interface PathPoint {
  lat: number;
  lng: number;
  /** Fix time, ms epoch. */
  t: number;
  speedKph?: number | null;
}

export interface PathSummary {
  /** Kept points, oldest first (for the polyline / playback). */
  points: PathPoint[];
  pointCount: number;
  droppedPoints: number;
  distanceM: number;
  durationMs: number;
  movingMs: number;
  maxGapMs: number;
  gapCount: number;
  startedAt: number | null;
  endedAt: number | null;
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * 1000;
}

export function reconstructPath(raw: PathPoint[]): PathSummary {
  const sorted = raw
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t))
    .slice()
    .sort((a, b) => a.t - b.t);

  const points: PathPoint[] = [];
  let dropped = raw.length - sorted.length;
  for (const p of sorted) {
    const prev = points[points.length - 1];
    if (prev) {
      const dt = p.t - prev.t;
      if (dt <= 0) { dropped++; continue; }
      const kph = (haversineM(prev, p) / dt) * 3600;
      if (kph > MAX_SPEED_KPH) { dropped++; continue; }
    }
    points.push(p);
  }

  let distanceM = 0;
  let movingMs = 0;
  let maxGapMs = 0;
  let gapCount = 0;
  let anchor = points[0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const p = points[i];
    const gap = p.t - prev.t;
    if (gap > maxGapMs) maxGapMs = gap;
    if (gap > GAP_MS) gapCount++;
    if (gap > BREAK_GAP_MS) {
      anchor = p; // path break: start a fresh segment here
      continue;
    }
    const d = haversineM(anchor, p);
    if (d >= JITTER_M) {
      const dt = p.t - anchor.t;
      distanceM += d;
      if (dt > 0 && (d / dt) * 3600 >= MOVING_KPH) movingMs += dt;
      anchor = p;
    }
  }

  const first = points[0];
  const last = points[points.length - 1];
  return {
    points,
    pointCount: points.length,
    droppedPoints: dropped,
    distanceM: Math.round(distanceM),
    durationMs: first && last ? last.t - first.t : 0,
    movingMs,
    maxGapMs,
    gapCount,
    startedAt: first ? first.t : null,
    endedAt: last ? last.t : null,
  };
}

/** Average speed over moving time, km/h (0 when the rider never moved). */
export function avgSpeedKph(distanceM: number, movingMs: number): number {
  if (movingMs <= 0) return 0;
  return Math.round(((distanceM / 1000) / (movingMs / 3_600_000)) * 10) / 10;
}

/** Evenly thin a long point list for display, always keeping first and last. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 2) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
