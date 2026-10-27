/**
 * Pure helpers for POST /api/rider/location — validation and ordering of GPS
 * points from the rider app, including batches flushed by the background
 * delivery-tracking task after the phone was offline.
 *
 * Rules (per rider, in-process — same single-instance assumption as the
 * route's DB throttle):
 *  - points are processed oldest-first by their fix time (`recordedAt`, ms
 *    epoch; legacy clients omit it → server time). When the client also sends
 *    `sentAt` (its own clock at send time) the fix times are shifted by
 *    (serverNow - sentAt), so a phone with a wrong clock still works;
 *  - a point not newer than the last accepted one is out-of-order or a
 *    duplicate → ignored;
 *  - a point from the future (beyond clock skew) or older than MAX_AGE_MS is
 *    ignored;
 *  - accepted points older than LIVE_MAX_AGE_MS are kept for the route trail
 *    but never shown as the rider's live position.
 */
import { z } from 'zod';

export const MAX_BATCH = 50;
/** A fix older than this is history, not the rider's live position. */
export const LIVE_MAX_AGE_MS = 2 * 60_000;
/** Older than this → dropped entirely (the offline queue holds ~2 h at most). */
export const MAX_AGE_MS = 6 * 60 * 60_000;
export const FUTURE_SKEW_MS = 60_000;
/**
 * Phone-clock correction only kicks in beyond this drift. Below it the gap is
 * just network latency, and shifting by it would make a re-sent duplicate look
 * newer than the copy already accepted.
 */
export const CLOCK_CORRECTION_MIN_MS = 30_000;
/** Min spacing between persisted trail points per rider. */
export const PERSIST_SPACING_MS = 3_000;

export const LocationPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKph: z.number().optional(),
  orderId: z.string().min(1).max(64).optional(),
  recordedAt: z.number().int().positive().optional(),
  // Location-integrity (anti-fraud): the OS "mock location" flag (expo-location
  // Android `mocked`) and the reported horizontal accuracy in metres. Both are
  // operational-location signals only. A mocked point is never used as a live
  // position (see the location route + server/rider-integrity).
  mocked: z.boolean().optional(),
  accuracy: z.number().nonnegative().optional()
});
export type LocationPoint = z.infer<typeof LocationPoint>;

const SentAt = z.number().int().positive().optional();

/**
 * Optional rider-insights device context; validated separately (strictly) by
 * server/rider-insights/device.ts so a bad value never rejects the points.
 */
const Device = z.unknown().optional();

/** Either one point (foreground app) or `{ points: [...] }` (background batch). */
export const LocationBody = z.union([
  z.object({ points: z.array(LocationPoint).min(1).max(MAX_BATCH), sentAt: SentAt, device: Device }),
  LocationPoint.extend({ sentAt: SentAt, device: Device })
]);
export type LocationBody = z.infer<typeof LocationBody>;

/** Normalise either body shape to a point list + optional device send time (+ raw device context). */
export function bodyPoints(body: LocationBody): { points: LocationPoint[]; sentAt?: number; device?: unknown } {
  if ('points' in body) return { points: body.points, sentAt: body.sentAt, device: body.device };
  const { sentAt, device, ...point } = body;
  return { points: [point], sentAt, device };
}

export type TimedPoint = LocationPoint & { t: number };

export interface ClassifiedPoints {
  /** In-order, in-window points, oldest first. */
  accepted: TimedPoint[];
  /** The newest accepted point when it is fresh enough to be "live". */
  live: TimedPoint | null;
  /** New high-water mark for this rider (unchanged if nothing accepted). */
  lastAcceptedAt: number | undefined;
}

export function classifyPoints(
  points: LocationPoint[],
  now: number,
  lastAcceptedAt: number | undefined,
  sentAt?: number
): ClassifiedPoints {
  const drift = sentAt !== undefined ? now - sentAt : 0;
  const offset = Math.abs(drift) > CLOCK_CORRECTION_MIN_MS ? drift : 0;
  const timed = points
    .map((p) => ({ ...p, t: p.recordedAt !== undefined ? p.recordedAt + offset : now }))
    .sort((a, b) => a.t - b.t);
  const accepted: TimedPoint[] = [];
  let mark = lastAcceptedAt;
  for (const p of timed) {
    if (p.t > now + FUTURE_SKEW_MS) continue;
    if (p.t < now - MAX_AGE_MS) continue;
    if (mark !== undefined && p.t <= mark) continue;
    accepted.push(p);
    mark = p.t;
  }
  const newest = accepted[accepted.length - 1];
  const live = newest && now - newest.t <= LIVE_MAX_AGE_MS ? newest : null;
  return { accepted, live, lastAcceptedAt: mark };
}

/** Thin accepted points to at most one per PERSIST_SPACING_MS (by fix time). */
export function pointsToPersist(
  accepted: TimedPoint[],
  lastPersistedAt: number | undefined
): { persist: TimedPoint[]; lastPersistedAt: number | undefined } {
  const persist: TimedPoint[] = [];
  let mark = lastPersistedAt;
  for (const p of accepted) {
    if (mark === undefined || p.t - mark >= PERSIST_SPACING_MS) {
      persist.push(p);
      mark = p.t;
    }
  }
  return { persist, lastPersistedAt: mark };
}

const CLOSED_ORDER_STATUSES = new Set([
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'CANCELLED_BY_ADMIN',
  'REFUND_PENDING',
  'REFUND_INITIATED',
  'REFUNDED'
]);

/** Is this assignment one the rider is still actively delivering? */
export function isActiveDelivery(assignmentStatus: string, orderStatus: string): boolean {
  return (
    (assignmentStatus === 'ACCEPTED' || assignmentStatus === 'PICKED_UP') &&
    !CLOSED_ORDER_STATUSES.has(orderStatus)
  );
}
