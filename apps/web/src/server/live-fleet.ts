/**
 * Live fleet snapshot — the one query behind the first paint of /platform/live
 * and /admin/live and the 4 s poll (GET /api/platform/riders/live).
 *
 * Who is on the map:
 *   - platform scope: every rider flagged online, plus any rider still working
 *     an active order even if the online flag dropped (a delivery in progress
 *     must never disappear from ops).
 *   - branch scope (restaurant admin): riders with a live assignment on one of
 *     the given branches.
 * Each rider carries the real GPS-fix time, a "signal lost" flag and the leg
 * they are on (see lib/live-fleet.ts).
 *
 * Online riders with no stored GPS fix cannot be plotted; they are returned in
 * `waiting` so ops still see them (and why: GPS off / never sent a fix).
 * Pre-launch test riders are included with a "TEST" label and `isTest`, so the
 * team can watch them during testing; the fleet numbers never count them.
 */
import { prisma } from './db';
import { resolveGroupContext } from './group-scope';
import { deriveRiderLive, isLiveAssignment, isStale, type FleetRider, type LatLng, type WaitingRider } from '@/lib/live-fleet';

const LIVE_ASSIGNMENT = ['PENDING', 'ACCEPTED', 'PICKED_UP'] as const;

export interface CustomerPin { id: string; name?: string; lat: number; lng: number }

export interface FleetSnapshot {
  riders: FleetRider[];
  /** Drop points of every order a rider on the map is working. */
  customers: CustomerPin[];
  /** Online riders with no GPS fix to plot yet. */
  waiting: WaitingRider[];
}

/** Map label: test riders are visibly marked so nobody mistakes them for fleet. */
export function fleetName(name: string | null | undefined, isTest: boolean): string {
  const base = name?.trim() || 'Rider';
  return isTest ? `TEST · ${base}` : base;
}

export async function loadFleetSnapshot(opts: { branchIds?: string[] } = {}): Promise<FleetSnapshot> {
  const now = Date.now();
  const branchScoped = Array.isArray(opts.branchIds);
  const assignmentWhere = {
    status: { in: [...LIVE_ASSIGNMENT] },
    ...(branchScoped ? { order: { branchId: { in: opts.branchIds! } } } : {}),
  };

  const profiles = await prisma.riderProfile.findMany({
    where: branchScoped
      ? { assignments: { some: assignmentWhere } }
      : { OR: [{ isOnline: true }, { assignments: { some: assignmentWhere } }] },
    select: {
      id: true,
      isOnline: true,
      currentLat: true,
      currentLng: true,
      updatedAt: true,
      user: { select: { name: true, isTestAccount: true } },
      assignments: {
        where: assignmentWhere,
        orderBy: { assignedAt: 'desc' },
        select: {
          status: true,
          assignedAt: true,
          order: {
            select: {
              id: true,
              status: true,
              customer: { select: { name: true } },
              branch: { select: { latitude: true, longitude: true } },
              address: { select: { latitude: true, longitude: true } },
            },
          },
        },
      },
    },
  });

  const heartbeats = profiles.length
    ? await prisma.riderHeartbeat.findMany({
        where: { riderId: { in: profiles.map((p) => p.id) } },
        select: { riderId: true, lastSeenAt: true, lastLocationAt: true, gpsEnabled: true },
      })
    : [];
  const hbById = new Map(heartbeats.map((h) => [h.riderId, h]));

  const riders: FleetRider[] = [];
  const customers: CustomerPin[] = [];
  const waiting: WaitingRider[] = [];
  for (const p of profiles) {
    // A rider only matched through an assignment whose order has since closed
    // (delivered / cancelled) is not working anything — keep them off the map
    // unless they are genuinely online.
    const working = p.assignments.some(isLiveAssignment);
    if (!working && (branchScoped || !p.isOnline)) continue;
    const isTest = Boolean(p.user?.isTestAccount);
    const hb = hbById.get(p.id) ?? null;
    const live = deriveRiderLive(
      {
        id: p.id,
        name: fleetName(p.user?.name, isTest),
        isTest,
        currentLat: p.currentLat,
        currentLng: p.currentLng,
        updatedAt: p.updatedAt,
        heartbeat: hb,
        assignments: p.assignments,
      },
      now,
    );
    if (!live) {
      // Online but nothing to plot — list them instead of dropping them.
      const seen = hb?.lastSeenAt ?? null;
      waiting.push({
        riderId: p.id,
        name: fleetName(p.user?.name, isTest),
        seenAt: seen ? seen.toISOString() : undefined,
        stale: isStale(seen, now),
        gpsEnabled: hb?.gpsEnabled ?? null,
        ...(isTest ? { isTest: true } : {}),
      });
      continue;
    }
    riders.push(live);
    for (const a of p.assignments) {
      if (!isLiveAssignment(a)) continue;
      const drop: LatLng | null =
        a.order.address?.latitude != null && a.order.address?.longitude != null
          ? { lat: Number(a.order.address.latitude), lng: Number(a.order.address.longitude) }
          : null;
      if (drop) {
        customers.push({ id: a.order.id, name: a.order.customer?.name ?? 'Customer', ...drop });
      }
    }
  }
  return { riders, customers, waiting };
}

/**
 * Branches a restaurant admin's live map covers: every active branch of the
 * active restaurant, or of the whole group when it is a group parent (riders
 * are shared across the group). Used by /admin/live and its poll so both scope
 * identically.
 */
export async function adminFleetBranches(restaurantId: string) {
  const group = await resolveGroupContext(restaurantId);
  const restaurantIds = group.restaurantIds.length ? group.restaurantIds : [restaurantId];
  const branches = await prisma.branch.findMany({
    where: { restaurantId: { in: restaurantIds }, isActive: true },
    select: { id: true, name: true, latitude: true, longitude: true, restaurant: { select: { name: true } } },
  });
  return { isGroup: group.isGroup, branches };
}
