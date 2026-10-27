/**
 * Rider safety & anomaly alerts — server-side sweep (every ~2 min).
 *
 * Builds on the existing OrderEscalation + AlertDebounce plumbing (same surface
 * as the RIDER_STATIONARY sweep and the stuck-order detector). For riders on an
 * active delivery it raises, debounces and auto-resolves four escalation types
 * that show up on /platform/live-ops:
 *
 *   ROUTE_DEVIATION          persistently off the restaurant→customer corridor
 *   ETA_BREACH               elapsed past the promised delivery time
 *   LONG_WAIT_AT_RESTAURANT  at the restaurant geofence, food READY, not picked up
 *   SIGNAL_LOST              prolonged GPS gap on an active delivery
 *
 * This uses operational location/status data ONLY (DeliveryLocationPing + order
 * timestamps). It never reads device/phone activity.
 *
 * Decision logic lives in the pure functions below (unit-tested without a DB);
 * runSafetyAlertsSweep() is the thin DB wrapper. Thresholds + per-type toggles
 * come from server/safety/settings.ts (super-admin tunable).
 *
 * Signal-loss references the masked-call path (/api/rider/assignments/[id]/
 * call-customer and /api/platform/telephony/calls) in its message — ops places
 * the call; this module does not dial.
 */
import { AssignmentStatus, OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { utcTs } from '../dispatch/events';
import { haversineKm } from '@/lib/utils';
import { getSafetyAlertSettings, type SafetyAlertSettings } from './settings';

const MIN = 60_000;
/** Latest fix older than this is treated as a signal gap, not a live position. */
export const MAX_FIX_AGE_MIN = 3;
/** Rider within this many metres of the restaurant counts as "at the restaurant". */
export const RESTAURANT_GEOFENCE_M = 150;
/** Per-assignment, per-type cooldown between opening alerts (anti-spam). */
export const SAFETY_DEBOUNCE_MIN = 20;

export interface LatLng {
  lat: number;
  lng: number;
}
export interface Fix extends LatLng {
  at: Date;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Metres between two lat/lng points (haversine). */
export function metresBetween(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

/** Perpendicular distance (m) from p to the segment a→b, via local equirectangular projection. */
export function pointToSegmentMetres(p: LatLng, a: LatLng, b: LatLng): number {
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos((a.lat * Math.PI) / 180);
  const px = (p.lng - a.lng) * mPerLng;
  const py = (p.lat - a.lat) * mPerLat;
  const bx = (b.lng - a.lng) * mPerLng;
  const by = (b.lat - a.lat) * mPerLat;
  const segLen2 = bx * bx + by * by;
  const t = segLen2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / segLen2));
  const dx = px - bx * t;
  const dy = py - by * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Min distance (m) from p to the polyline through `legs` (expected corridor). */
export function corridorDistanceM(p: LatLng, legs: LatLng[]): number {
  if (legs.length === 0) return Infinity;
  if (legs.length === 1) return metresBetween(p, legs[0]);
  let min = Infinity;
  for (let i = 0; i < legs.length - 1; i++) {
    const d = pointToSegmentMetres(p, legs[i], legs[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

// ── Pure verdicts ──────────────────────────────────────────────────────────

export interface RouteDeviationInput {
  now: Date;
  latest: Fix | null;
  /** Latest fix at or before (now − window); proves the deviation persisted. */
  anchor: Fix | null;
  corridor: LatLng[];
  windowMin: number;
  metres: number;
  maxFixAgeMin?: number;
}
export interface RouteDeviationVerdict {
  deviated: boolean;
  reason: 'deviated' | 'no_corridor' | 'no_fix' | 'stale_fix' | 'no_window' | 'on_track' | 'transient';
  metres: number;
  minutes: number;
}

export function routeDeviationVerdict(i: RouteDeviationInput): RouteDeviationVerdict {
  const maxAge = i.maxFixAgeMin ?? MAX_FIX_AGE_MIN;
  if (i.corridor.length < 2) return { deviated: false, reason: 'no_corridor', metres: 0, minutes: 0 };
  if (!i.latest) return { deviated: false, reason: 'no_fix', metres: 0, minutes: 0 };
  if (i.now.getTime() - i.latest.at.getTime() > maxAge * MIN) return { deviated: false, reason: 'stale_fix', metres: 0, minutes: 0 };
  if (!i.anchor || i.now.getTime() - i.anchor.at.getTime() < i.windowMin * MIN) {
    return { deviated: false, reason: 'no_window', metres: 0, minutes: 0 };
  }
  const dLatest = corridorDistanceM(i.latest, i.corridor);
  const minutes = Math.round((i.now.getTime() - i.anchor.at.getTime()) / MIN);
  if (dLatest <= i.metres) return { deviated: false, reason: 'on_track', metres: Math.round(dLatest), minutes };
  const dAnchor = corridorDistanceM(i.anchor, i.corridor);
  if (dAnchor <= i.metres) return { deviated: false, reason: 'transient', metres: Math.round(dLatest), minutes };
  return { deviated: true, reason: 'deviated', metres: Math.round(dLatest), minutes };
}

export interface EtaBreachInput {
  now: Date;
  promisedAt: Date | null;
  deliveredAt: Date | null;
  thresholdMin: number;
}
export interface EtaBreachVerdict {
  breached: boolean;
  reason: 'breached' | 'delivered' | 'no_promise' | 'within_sla';
  overdueMin: number;
}

export function etaBreachVerdict(i: EtaBreachInput): EtaBreachVerdict {
  if (i.deliveredAt) return { breached: false, reason: 'delivered', overdueMin: 0 };
  if (!i.promisedAt) return { breached: false, reason: 'no_promise', overdueMin: 0 };
  const overdueMin = Math.round((i.now.getTime() - i.promisedAt.getTime()) / MIN);
  if (overdueMin < i.thresholdMin) return { breached: false, reason: 'within_sla', overdueMin };
  return { breached: true, reason: 'breached', overdueMin };
}

export interface LongWaitInput {
  now: Date;
  atRestaurant: boolean;
  foodReadyAt: Date | null;
  pickedUp: boolean;
  thresholdMin: number;
}
export interface LongWaitVerdict {
  waiting: boolean;
  reason: 'waiting' | 'picked_up' | 'not_at_restaurant' | 'not_ready' | 'within_threshold';
  minutes: number;
}

export function longWaitVerdict(i: LongWaitInput): LongWaitVerdict {
  if (i.pickedUp) return { waiting: false, reason: 'picked_up', minutes: 0 };
  if (!i.atRestaurant) return { waiting: false, reason: 'not_at_restaurant', minutes: 0 };
  if (!i.foodReadyAt) return { waiting: false, reason: 'not_ready', minutes: 0 };
  const minutes = Math.round((i.now.getTime() - i.foodReadyAt.getTime()) / MIN);
  if (minutes < i.thresholdMin) return { waiting: false, reason: 'within_threshold', minutes };
  return { waiting: true, reason: 'waiting', minutes };
}

export interface SignalLossInput {
  now: Date;
  lastFixAt: Date | null;
  /** When the active leg began (fallback when there has never been a fix). */
  activeSince: Date | null;
  thresholdMin: number;
}
export interface SignalLossVerdict {
  lost: boolean;
  reason: 'lost' | 'live' | 'unknown';
  gapMin: number;
}

export function signalLossVerdict(i: SignalLossInput): SignalLossVerdict {
  const ref = i.lastFixAt ?? i.activeSince;
  if (!ref) return { lost: false, reason: 'unknown', gapMin: 0 };
  const gapMin = Math.round((i.now.getTime() - ref.getTime()) / MIN);
  if (gapMin < i.thresholdMin) return { lost: false, reason: 'live', gapMin };
  return { lost: true, reason: 'lost', gapMin };
}

/** Corridor (expected path) for the delivery leg: restaurant → customer. */
export function deliveryCorridor(branch: LatLng | null, drop: LatLng | null): LatLng[] {
  const legs: LatLng[] = [];
  if (branch) legs.push(branch);
  if (drop) legs.push(drop);
  return legs;
}

// ── DB sweep ─────────────────────────────────────────────────────────────────

export const SAFETY_ALERT_TYPES = ['ROUTE_DEVIATION', 'ETA_BREACH', 'LONG_WAIT_AT_RESTAURANT', 'SIGNAL_LOST'] as const;
export type SafetyAlertType = (typeof SAFETY_ALERT_TYPES)[number];

const TERMINAL: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
];

interface FixRow {
  riderId: string;
  l_lat: number | null;
  l_lng: number | null;
  l_at: Date | null;
  a_lat: number | null;
  a_lng: number | null;
  a_at: Date | null;
}

/** Per rider: the latest fix (any age) and the latest fix at/before the deviation window. */
async function fixSummaries(riderIds: string[], now: Date, windowMin: number): Promise<Map<string, FixRow>> {
  if (riderIds.length === 0) return new Map();
  const windowStart = new Date(now.getTime() - windowMin * MIN);
  const anchorFloor = new Date(windowStart.getTime() - 15 * MIN);
  const rows = await prisma.$queryRaw<FixRow[]>(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (p."riderId") p."riderId", p.lat, p.lng, p."createdAt"
      FROM "DeliveryLocationPing" p
      WHERE p."riderId" IN (${Prisma.join(riderIds)})
      ORDER BY p."riderId", p."createdAt" DESC
    ),
    anchor AS (
      SELECT DISTINCT ON (p."riderId") p."riderId", p.lat, p.lng, p."createdAt"
      FROM "DeliveryLocationPing" p
      WHERE p."riderId" IN (${Prisma.join(riderIds)})
        AND p."createdAt" <= ${utcTs(windowStart)} AND p."createdAt" >= ${utcTs(anchorFloor)}
      ORDER BY p."riderId", p."createdAt" DESC
    )
    SELECT l."riderId",
           l.lat AS l_lat, l.lng AS l_lng, l."createdAt" AS l_at,
           a.lat AS a_lat, a.lng AS a_lng, a."createdAt" AS a_at
    FROM latest l
    LEFT JOIN anchor a ON a."riderId" = l."riderId"
  `);
  return new Map(rows.map((r) => [r.riderId, r]));
}

export interface SafetySweepResult {
  checked: number;
  alerted: number;
  resolved: number;
  debounced: number;
  byType: Record<SafetyAlertType, number>;
}

export async function runSafetyAlertsSweep(
  now: Date = new Date(),
  cfg: SafetyAlertSettings | null = null
): Promise<SafetySweepResult> {
  const settings = cfg ?? (await getSafetyAlertSettings());
  const byType: Record<SafetyAlertType, number> = {
    ROUTE_DEVIATION: 0,
    ETA_BREACH: 0,
    LONG_WAIT_AT_RESTAURANT: 0,
    SIGNAL_LOST: 0,
  };
  let alerted = 0;
  let resolved = 0;
  let debounced = 0;

  const active = await prisma.riderAssignment.findMany({
    where: {
      status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP] },
      order: { status: { notIn: TERMINAL } },
    },
    select: {
      id: true,
      riderId: true,
      status: true,
      order: {
        select: {
          id: true,
          code: true,
          readyAt: true,
          outForDeliveryAt: true,
          deliveredAt: true,
          estimatedDeliveryAt: true,
          branch: { select: { latitude: true, longitude: true } },
          address: { select: { latitude: true, longitude: true } },
        },
      },
    },
    take: 1000,
  });

  const summaries = await fixSummaries(
    [...new Set(active.map((a) => a.riderId))],
    now,
    settings.routeDeviation.minutes
  );

  for (const a of active) {
    const o = a.order;
    const m = summaries.get(a.riderId);
    const latest: Fix | null =
      m && m.l_lat != null && m.l_lng != null && m.l_at ? { lat: m.l_lat, lng: m.l_lng, at: new Date(m.l_at) } : null;
    const anchor: Fix | null =
      m && m.a_lat != null && m.a_lng != null && m.a_at ? { lat: m.a_lat, lng: m.a_lng, at: new Date(m.a_at) } : null;
    const branch: LatLng | null =
      o.branch.latitude != null && o.branch.longitude != null ? { lat: o.branch.latitude, lng: o.branch.longitude } : null;
    const drop: LatLng | null =
      o.address?.latitude != null && o.address?.longitude != null ? { lat: o.address.latitude, lng: o.address.longitude } : null;
    const pickedUp = a.status === AssignmentStatus.PICKED_UP;
    const atRestaurant = latest != null && branch != null && metresBetween(latest, branch) <= RESTAURANT_GEOFENCE_M;
    const activeSince = o.outForDeliveryAt ?? o.readyAt ?? null;

    // 1) Route deviation — only on the delivery leg (restaurant→customer corridor).
    if (settings.routeDeviation.enabled && pickedUp) {
      const v = routeDeviationVerdict({
        now,
        latest,
        anchor,
        corridor: deliveryCorridor(branch, drop),
        windowMin: settings.routeDeviation.minutes,
        metres: settings.routeDeviation.metres,
      });
      await apply(a.id, o.id, 'ROUTE_DEVIATION', v.deviated, 'MEDIUM', `${o.code}: rider ${v.metres} m off the expected route for ${v.minutes}m`, now);
    } else {
      resolved += await resolve(o.id, 'ROUTE_DEVIATION', now);
    }

    // 2) ETA breach — elapsed past the promised delivery time.
    if (settings.etaBreach.enabled) {
      const v = etaBreachVerdict({ now, promisedAt: o.estimatedDeliveryAt, deliveredAt: o.deliveredAt, thresholdMin: settings.etaBreach.minutes });
      const sev = v.overdueMin >= settings.etaBreach.minutes * 2 ? 'HIGH' : 'MEDIUM';
      await apply(a.id, o.id, 'ETA_BREACH', v.breached, sev, `${o.code}: ${v.overdueMin}m past the promised delivery time`, now);
    } else {
      resolved += await resolve(o.id, 'ETA_BREACH', now);
    }

    // 3) Long wait at restaurant — at the geofence, food READY, not picked up.
    if (settings.longWaitAtRestaurant.enabled) {
      const v = longWaitVerdict({ now, atRestaurant, foodReadyAt: o.readyAt, pickedUp, thresholdMin: settings.longWaitAtRestaurant.minutes });
      const sev = v.minutes >= settings.longWaitAtRestaurant.minutes * 2 ? 'HIGH' : 'MEDIUM';
      await apply(a.id, o.id, 'LONG_WAIT_AT_RESTAURANT', v.waiting, sev, `${o.code}: rider at restaurant ${v.minutes}m but not picked up`, now);
    } else {
      resolved += await resolve(o.id, 'LONG_WAIT_AT_RESTAURANT', now);
    }

    // 4) Prolonged signal loss — ops should call the rider (masked-call path).
    if (settings.signalLoss.enabled) {
      const v = signalLossVerdict({ now, lastFixAt: latest?.at ?? null, activeSince, thresholdMin: settings.signalLoss.minutes });
      const sev = v.gapMin >= settings.signalLoss.minutes * 2 ? 'CRITICAL' : 'HIGH';
      await apply(a.id, o.id, 'SIGNAL_LOST', v.lost, sev, `${o.code}: no GPS for ${v.gapMin}m — call the rider (masked) from the order`, now);
    } else {
      resolved += await resolve(o.id, 'SIGNAL_LOST', now);
    }
  }

  // Cleanup: auto-resolve any of our alerts left OPEN on orders that have ended.
  const cleaned = await prisma.orderEscalation.updateMany({
    where: {
      type: { in: SAFETY_ALERT_TYPES as unknown as any[] },
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      order: { status: { in: TERMINAL } },
    },
    data: { status: 'RESOLVED', resolvedAt: now, resolvedBy: 'auto' },
  });
  resolved += cleaned.count;

  async function resolve(orderId: string, type: SafetyAlertType, at: Date): Promise<number> {
    const r = await prisma.orderEscalation.updateMany({
      where: { orderId, type: type as any, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      data: { status: 'RESOLVED', resolvedAt: at, resolvedBy: 'auto' },
    });
    return r.count;
  }

  async function apply(
    assignmentId: string,
    orderId: string,
    type: SafetyAlertType,
    triggered: boolean,
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    message: string,
    at: Date
  ): Promise<void> {
    if (!triggered) {
      resolved += await resolve(orderId, type, at);
      return;
    }
    const kind = `safety:${type}`;
    const open = await prisma.orderEscalation.findFirst({
      where: { orderId, type: type as any, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      select: { id: true },
    });
    if (open) return; // already surfaced; nothing to do
    const deb = await prisma.alertDebounce.findUnique({
      where: { entityType_entityId_kind: { entityType: 'RiderAssignment', entityId: assignmentId, kind } },
      select: { lastSentAt: true },
    });
    if (deb && at.getTime() - deb.lastSentAt.getTime() < SAFETY_DEBOUNCE_MIN * MIN) {
      debounced++;
      return;
    }
    await prisma.orderEscalation.create({ data: { orderId, type: type as any, severity: severity as any, message } });
    await prisma.alertDebounce.upsert({
      where: { entityType_entityId_kind: { entityType: 'RiderAssignment', entityId: assignmentId, kind } },
      update: { lastSentAt: at, payload: { type, orderId } },
      create: { entityType: 'RiderAssignment', entityId: assignmentId, kind, lastSentAt: at, payload: { type, orderId } },
    });
    alerted++;
    byType[type]++;
  }

  return { checked: active.length, alerted, resolved, debounced, byType };
}
