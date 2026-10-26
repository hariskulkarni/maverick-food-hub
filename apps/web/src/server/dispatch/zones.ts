/**
 * Zone supply/demand lite (every 5 min).
 *
 * Buckets open (unassigned) DELIVERY orders by their restaurant's H3 res-8
 * cell and online riders by their last stored fix (RiderProfile.currentLat/Lng,
 * read-only) into ZoneSupplyDemand(bucketAt, h3Cell). Idle = no active
 * assignment. Riders with no recent fix land in h3Cell "none" so the totals
 * still count them (they feed orders-per-rider-hour on the dashboard).
 *
 * h3-js: Uber's reference H3 implementation (pure JS/WASM, no native build);
 * H3 res-8 (~0.7 km² hexes) is what the roadmap specifies for zones.
 */
import { latLngToCell } from 'h3-js';
import { AssignmentStatus, FulfillmentType, OrderStatus } from '@prisma/client';
import { prisma } from '../db';

export const H3_RES = 8;
export const BUCKET_MIN = 5;
export const NO_FIX_CELL = 'none';
const RIDER_FIX_MAX_AGE_MS = 15 * 60_000;
const RETENTION_DAYS = 90;

export function bucketStart(now: Date): Date {
  const ms = BUCKET_MIN * 60_000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export function cellFor(lat: number | null | undefined, lng: number | null | undefined): string {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return NO_FIX_CELL;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return NO_FIX_CELL;
  return latLngToCell(lat, lng, H3_RES);
}

export interface ZoneCounts { openOrders: number; idleRiders: number; busyRiders: number }

/** Pure aggregation into cell → counts. */
export function aggregateZones(
  orders: Array<{ lat: number | null; lng: number | null }>,
  riders: Array<{ lat: number | null; lng: number | null; busy: boolean; fresh: boolean }>
): Map<string, ZoneCounts> {
  const m = new Map<string, ZoneCounts>();
  const get = (c: string) => {
    let v = m.get(c);
    if (!v) { v = { openOrders: 0, idleRiders: 0, busyRiders: 0 }; m.set(c, v); }
    return v;
  };
  for (const o of orders) get(cellFor(o.lat, o.lng)).openOrders++;
  for (const r of riders) {
    const c = r.fresh ? cellFor(r.lat, r.lng) : NO_FIX_CELL;
    if (r.busy) get(c).busyRiders++;
    else get(c).idleRiders++;
  }
  return m;
}

export async function runZoneSnapshot(now: Date = new Date()): Promise<{ bucketAt: string; cells: number; openOrders: number; riders: number; pruned: number }> {
  const bucketAt = bucketStart(now);
  const [orders, riders] = await Promise.all([
    prisma.order.findMany({
      where: {
        fulfillmentType: FulfillmentType.DELIVERY,
        status: { in: [OrderStatus.RECEIVED, OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY] },
        assignment: null,
        // Pre-launch test orders/riders (server/test-accounts.ts) are not demand/supply.
        customer: { isTestAccount: false },
      },
      select: { branch: { select: { latitude: true, longitude: true } } },
      take: 5000,
    }),
    prisma.riderProfile.findMany({
      where: { isOnline: true, approvedAt: { not: null }, user: { isTestAccount: false } },
      select: {
        currentLat: true,
        currentLng: true,
        updatedAt: true,
        _count: { select: { assignments: { where: { status: { in: [AssignmentStatus.PENDING, AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP] } } } } },
      },
      take: 5000,
    }),
  ]);
  const agg = aggregateZones(
    orders.map((o) => ({ lat: o.branch.latitude, lng: o.branch.longitude })),
    riders.map((r) => ({
      lat: r.currentLat,
      lng: r.currentLng,
      busy: r._count.assignments > 0,
      fresh: now.getTime() - r.updatedAt.getTime() <= RIDER_FIX_MAX_AGE_MS,
    }))
  );
  const data = [...agg.entries()].map(([h3Cell, c]) => ({ bucketAt, h3Cell, ...c }));
  // Re-running inside the same bucket replaces that bucket (idempotent).
  await prisma.$transaction([
    prisma.zoneSupplyDemand.deleteMany({ where: { bucketAt } }),
    prisma.zoneSupplyDemand.createMany({ data }),
  ]);
  const pruned = await prisma.zoneSupplyDemand.deleteMany({ where: { bucketAt: { lt: new Date(now.getTime() - RETENTION_DAYS * 86_400_000) } } });
  return { bucketAt: bucketAt.toISOString(), cells: data.length, openOrders: orders.length, riders: riders.length, pruned: pruned.count };
}
