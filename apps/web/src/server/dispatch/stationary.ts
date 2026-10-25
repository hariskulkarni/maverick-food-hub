/**
 * Server-side stationary-rider alert (every 2 min).
 *
 * A rider on an active task (assignment ACCEPTED / PICKED_UP) whose stored GPS
 * fixes (DeliveryLocationPing, read-only) show < 50 m of movement for ≥ 8 min,
 * while outside the restaurant and customer geofence, gets an OrderEscalation
 * (type RIDER_STATIONARY) on /platform/live-ops. Debounced per assignment via
 * AlertDebounce, and never duplicated while an OPEN one exists.
 *
 * A rider with NO recent fix is not "stationary" — that case is the existing
 * RIDER_NOT_MOVING (no GPS) escalation in escalations.ts.
 *
 * Tunables (env): STATIONARY_WINDOW_MIN=8, STATIONARY_MOVE_M=50,
 * STATIONARY_GEOFENCE_M=150, STATIONARY_DEBOUNCE_MIN=30.
 */
import { AssignmentStatus, OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { utcTs } from './events';
import { haversineKm } from '@/lib/utils';

const MIN = 60_000;

function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export interface StationaryConfig {
  windowMin: number;
  moveM: number;
  geofenceM: number;
  debounceMin: number;
  /** Latest fix must be at most this old (else it's a GPS gap, not a stop). */
  maxFixAgeMin: number;
}

export function stationaryConfig(): StationaryConfig {
  return {
    windowMin: envNum('STATIONARY_WINDOW_MIN', 8),
    moveM: envNum('STATIONARY_MOVE_M', 50),
    geofenceM: envNum('STATIONARY_GEOFENCE_M', 150),
    debounceMin: envNum('STATIONARY_DEBOUNCE_MIN', 30),
    maxFixAgeMin: 3,
  };
}

interface Fix { lat: number; lng: number; at: Date }
interface LatLng { lat: number; lng: number }

export interface StationaryInput {
  now: Date;
  /** Latest fix at or before (now − window). Proves we observed the whole window. */
  anchor: Fix | null;
  latest: Fix | null;
  /** Max distance (m) of any fix after the anchor from the anchor. */
  maxMoveM: number;
  pickup: LatLng | null;
  drop: LatLng | null;
  cfg: StationaryConfig;
}

export interface StationaryVerdict {
  stationary: boolean;
  minutes: number;
  reason: 'stationary' | 'no_anchor' | 'stale_fix' | 'moved' | 'at_pickup' | 'at_drop';
}

/** Pure decision on a rider's movement summary. */
export function isStationary(i: StationaryInput): StationaryVerdict {
  if (!i.anchor || !i.latest) return { stationary: false, minutes: 0, reason: 'no_anchor' };
  const minutes = Math.round((i.now.getTime() - i.anchor.at.getTime()) / MIN);
  if (i.now.getTime() - i.latest.at.getTime() > i.cfg.maxFixAgeMin * MIN) return { stationary: false, minutes, reason: 'stale_fix' };
  if (i.now.getTime() - i.anchor.at.getTime() < i.cfg.windowMin * MIN) return { stationary: false, minutes, reason: 'no_anchor' };
  const moved = Math.max(i.maxMoveM, haversineKm(i.anchor, i.latest) * 1000);
  if (moved >= i.cfg.moveM) return { stationary: false, minutes, reason: 'moved' };
  if (i.pickup && haversineKm(i.latest, i.pickup) * 1000 <= i.cfg.geofenceM) return { stationary: false, minutes, reason: 'at_pickup' };
  if (i.drop && haversineKm(i.latest, i.drop) * 1000 <= i.cfg.geofenceM) return { stationary: false, minutes, reason: 'at_drop' };
  return { stationary: true, minutes, reason: 'stationary' };
}

interface MovementRow {
  riderId: string;
  a_lat: number;
  a_lng: number;
  a_at: Date;
  l_lat: number | null;
  l_lng: number | null;
  l_at: Date | null;
  max_move_m: number | null;
}

/** One round-trip: per rider, the anchor fix, the latest fix and max displacement since the anchor. */
async function movementSummaries(riderIds: string[], now: Date, cfg: StationaryConfig): Promise<Map<string, MovementRow>> {
  if (riderIds.length === 0) return new Map();
  const windowStart = new Date(now.getTime() - cfg.windowMin * MIN);
  const anchorFloor = new Date(windowStart.getTime() - 10 * MIN);
  const rows = await prisma.$queryRaw<MovementRow[]>(Prisma.sql`
    WITH a AS (
      SELECT DISTINCT ON (p."riderId") p."riderId", p.lat, p.lng, p."createdAt"
      FROM "DeliveryLocationPing" p
      WHERE p."riderId" IN (${Prisma.join(riderIds)})
        AND p."createdAt" <= ${utcTs(windowStart)} AND p."createdAt" >= ${utcTs(anchorFloor)}
      ORDER BY p."riderId", p."createdAt" DESC
    ),
    w AS (
      SELECT p."riderId", p.lat, p.lng, p."createdAt",
             sqrt(power((p.lat - a.lat) * 111320, 2) + power((p.lng - a.lng) * 111320 * cos(radians(a.lat)), 2)) AS d,
             row_number() OVER (PARTITION BY p."riderId" ORDER BY p."createdAt" DESC) AS rn
      FROM "DeliveryLocationPing" p
      JOIN a ON a."riderId" = p."riderId"
      WHERE p."riderId" IN (${Prisma.join(riderIds)}) AND p."createdAt" > ${utcTs(windowStart)}
    )
    SELECT a."riderId", a.lat AS a_lat, a.lng AS a_lng, a."createdAt" AS a_at,
           l.lat AS l_lat, l.lng AS l_lng, l."createdAt" AS l_at,
           (SELECT max(w.d) FROM w WHERE w."riderId" = a."riderId")::float8 AS max_move_m
    FROM a
    LEFT JOIN w l ON l."riderId" = a."riderId" AND l.rn = 1
  `);
  return new Map(rows.map((r) => [r.riderId, r]));
}

export async function runStationarySweep(now: Date = new Date(), cfg: StationaryConfig = stationaryConfig()): Promise<{ checked: number; alerted: number; debounced: number }> {
  const active = await prisma.riderAssignment.findMany({
    where: {
      status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP] },
      order: { status: { notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED_BY_CUSTOMER, OrderStatus.CANCELLED_BY_RESTAURANT, OrderStatus.DELIVERY_FAILED] } },
    },
    select: {
      id: true,
      riderId: true,
      status: true,
      order: { select: { id: true, code: true, branch: { select: { latitude: true, longitude: true } }, address: { select: { latitude: true, longitude: true } } } },
    },
    take: 1000,
  });
  const summaries = await movementSummaries([...new Set(active.map((a) => a.riderId))], now, cfg);
  let alerted = 0;
  let debounced = 0;
  for (const a of active) {
    const m = summaries.get(a.riderId);
    const b = a.order.branch;
    const ad = a.order.address;
    const verdict = isStationary({
      now,
      anchor: m ? { lat: m.a_lat, lng: m.a_lng, at: new Date(m.a_at) } : null,
      latest: m && m.l_lat != null && m.l_lng != null && m.l_at ? { lat: m.l_lat, lng: m.l_lng, at: new Date(m.l_at) } : null,
      maxMoveM: m?.max_move_m ?? 0,
      pickup: b.latitude != null && b.longitude != null ? { lat: b.latitude, lng: b.longitude } : null,
      drop: ad?.latitude != null && ad?.longitude != null ? { lat: ad.latitude, lng: ad.longitude } : null,
      cfg,
    });
    if (!verdict.stationary) continue;
    const deb = await prisma.alertDebounce.findUnique({
      where: { entityType_entityId_kind: { entityType: 'RiderAssignment', entityId: a.id, kind: 'stationary' } },
      select: { lastSentAt: true },
    });
    if (deb && now.getTime() - deb.lastSentAt.getTime() < cfg.debounceMin * MIN) { debounced++; continue; }
    const open = await prisma.orderEscalation.findFirst({ where: { orderId: a.order.id, type: 'RIDER_STATIONARY', status: 'OPEN' }, select: { id: true } });
    if (!open) {
      const leg = a.status === AssignmentStatus.PICKED_UP ? 'heading to customer' : 'heading to restaurant';
      await prisma.orderEscalation.create({
        data: {
          orderId: a.order.id,
          type: 'RIDER_STATIONARY',
          severity: verdict.minutes >= 15 ? 'HIGH' : 'MEDIUM',
          message: `${a.order.code}: rider stationary ${verdict.minutes}m (moved < ${cfg.moveM} m) while ${leg}`,
        },
      });
      alerted++;
    }
    await prisma.alertDebounce.upsert({
      where: { entityType_entityId_kind: { entityType: 'RiderAssignment', entityId: a.id, kind: 'stationary' } },
      update: { lastSentAt: now, payload: { minutes: verdict.minutes, orderId: a.order.id } },
      create: { entityType: 'RiderAssignment', entityId: a.id, kind: 'stationary', lastSentAt: now, payload: { minutes: verdict.minutes, orderId: a.order.id } },
    });
  }
  return { checked: active.length, alerted, debounced };
}
