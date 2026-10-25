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
 */
import { prisma } from './db';
import { deriveRiderLive, isLiveAssignment, type FleetRider, type LatLng } from '@/lib/live-fleet';

const LIVE_ASSIGNMENT = ['PENDING', 'ACCEPTED', 'PICKED_UP'] as const;

export interface CustomerPin { id: string; name?: string; lat: number; lng: number }

export interface FleetSnapshot {
  riders: FleetRider[];
  /** Drop points of every order a rider on the map is working. */
  customers: CustomerPin[];
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
      user: { select: { name: true } },
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
        select: { riderId: true, lastSeenAt: true, lastLocationAt: true },
      })
    : [];
  const hbById = new Map(heartbeats.map((h) => [h.riderId, h]));

  const riders: FleetRider[] = [];
  const customers: CustomerPin[] = [];
  for (const p of profiles) {
    // A rider only matched through an assignment whose order has since closed
    // (delivered / cancelled) is not working anything — keep them off the map
    // unless they are genuinely online.
    const working = p.assignments.some(isLiveAssignment);
    if (!working && (branchScoped || !p.isOnline)) continue;
    const live = deriveRiderLive(
      {
        id: p.id,
        name: p.user?.name,
        currentLat: p.currentLat,
        currentLng: p.currentLng,
        updatedAt: p.updatedAt,
        heartbeat: hbById.get(p.id) ?? null,
        assignments: p.assignments,
      },
      now,
    );
    if (!live) continue;
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
  return { riders, customers };
}
