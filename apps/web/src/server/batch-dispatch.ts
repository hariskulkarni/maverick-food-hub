/**
 * Batch-dispatch engine — opportunistic order batching for the rider pool.
 *
 * When the live pool has more READY/RECEIVED orders waiting than free riders
 * to take them, this module looks at riders who are already OUT_FOR_DELIVERY
 * and whose current trip happens to brush near a new pickup point. Each
 * candidate gets a 15-second BatchInvitation row + a push (and an SSE event
 * on `rider:<riderId>:batch-invitation`). The first rider to accept gets the
 * new order added to their queue; the other invitations are auto-cancelled.
 *
 * The economics shown to the rider (`detourKm`, `extraEarnings`, `pickupEtaMin`)
 * are stamped onto the invitation at creation time so the modal never has to
 * recompute them.
 *
 * Sourcing-policy enforcement (FLEET / DEDICATED / DEDICATED_FIRST) lives in
 * `rider-sourcing.ts` — this module complements that by handling the
 * already-on-a-delivery case. The orchestrator (`orders.ts`) decides when to
 * call `maybeOfferAsBatch(orderId)` (typically right after an order goes
 * READY); this module is the side-effect-free brain behind that call.
 */
import { AssignmentStatus, OrderStatus, Prisma } from '@prisma/client';
import { prisma } from './db';
import { haversineKm } from '@/lib/utils';
import { publish } from './realtime';
import { log } from './log';
import { sendBatchInvitationPush } from './rider-push';

/** Hard caps that gate whether a rider is even considered. */
const MAX_RIDER_TO_PICKUP_KM = 5;
const MAX_HEAD_TO_DROP_RADIUS_KM = 3;
const MAX_MINS_REMAINING_FALLBACK = 30;
const MAX_DETOUR_KM = 4;
const TTL_SECONDS = 15;
const MAX_INVITES_PER_ORDER = 3;
const AVG_URBAN_KPH = 30;

interface Coord {
  lat: number;
  lng: number;
}

/**
 * Should we even bother batching this order? Returns true when the live pool
 * has more unassigned orders than there are free riders to take them, which
 * means the fleet is capacity-constrained and a batched offer is justified.
 */
async function shouldBatchOrder(): Promise<boolean> {
  // "Free" rider — online with no current active assignment.
  const freeRiders = await prisma.riderProfile.count({
    where: {
      isOnline: true,
      assignments: {
        none: { status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP] } },
      },
    },
  });
  // "Unassigned" order — restaurant has surfaced it (READY or RECEIVED) but
  // no rider has claimed it yet.
  const unassignedOrders = await prisma.order.count({
    where: {
      status: { in: [OrderStatus.READY, OrderStatus.RECEIVED] },
      assignment: null,
    },
  });
  // Strictly more orders than free riders → batching is worth it.
  return unassignedOrders > freeRiders;
}

/**
 * Estimate minutes of trip remaining for a rider who is mid-delivery.
 * We don't have a real ETA — we approximate as haversine(rider → drop) / 30kph.
 * If the rider has no current GPS, returns Infinity (i.e. "unknown, conservative").
 */
function estimateMinsRemaining(riderLoc: Coord | null, drop: Coord | null): number {
  if (!riderLoc || !drop) return Infinity;
  const km = haversineKm(riderLoc, drop);
  return (km / AVG_URBAN_KPH) * 60;
}

/**
 * The public entry point. Returns the number of invitations created. Safe to
 * call from anywhere in the order lifecycle — at worst it returns `{invited:0}`.
 */
export async function maybeOfferAsBatch(
  orderId: string
): Promise<{ invited: number }> {
  try {
    // 1. Load the order we're trying to batch. Need pickup (branch lat/lng)
    //    and drop (address lat/lng); if either is missing we can't compute a
    //    detour and silently skip.
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { branch: true, address: true },
    });
    if (!order) return { invited: 0 };
    if (
      order.branch.latitude == null ||
      order.branch.longitude == null ||
      !order.address ||
      order.address.latitude == null ||
      order.address.longitude == null
    ) {
      return { invited: 0 };
    }

    const pickup: Coord = { lat: order.branch.latitude, lng: order.branch.longitude };
    const newDrop: Coord = { lat: order.address.latitude, lng: order.address.longitude };

    // 2. Capacity check — if there's enough free supply, we don't batch.
    if (!(await shouldBatchOrder())) return { invited: 0 };

    // 3. Find candidate riders: OUT_FOR_DELIVERY with exactly one active
    //    assignment, whose current GPS is within MAX_RIDER_TO_PICKUP_KM of
    //    the new pickup. We pull a generous superset and refine in memory.
    //
    //    Note: the original drop is reached via the rider's current active
    //    assignment → order → address. We include everything in one query so
    //    we don't N+1.
    const busyRiders = await prisma.riderProfile.findMany({
      where: {
        isOnline: true,
        currentLat: { not: null },
        currentLng: { not: null },
        assignments: {
          some: {
            status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP] },
          },
        },
      },
      include: {
        assignments: {
          where: {
            status: { in: [AssignmentStatus.ACCEPTED, AssignmentStatus.PICKED_UP] },
          },
          include: { order: { include: { address: true } } },
        },
      },
    });

    interface Candidate {
      riderId: string;
      expoPushToken: string | null;
      detourKm: number;
      extraEarnings: number;
      pickupEtaMin: number;
    }

    const candidates: Candidate[] = [];

    for (const r of busyRiders) {
      // Must have EXACTLY one active assignment — multi-batch rider is excluded.
      if (r.assignments.length !== 1) continue;
      if (r.currentLat == null || r.currentLng == null) continue;
      const riderLoc: Coord = { lat: r.currentLat, lng: r.currentLng };

      const active = r.assignments[0];
      const origDropAddr = active.order.address;
      const originalDrop: Coord | null =
        origDropAddr && origDropAddr.latitude != null && origDropAddr.longitude != null
          ? { lat: origDropAddr.latitude, lng: origDropAddr.longitude }
          : null;

      // Distance gate: rider's current loc must be within 5 km of the new pickup.
      const riderToPickup = haversineKm(riderLoc, pickup);
      if (riderToPickup > MAX_RIDER_TO_PICKUP_KM) continue;

      // Routing gate: their existing drop is near the new pickup OR their
      // remaining trip is short (<30 min). Either qualifies them as "on the way".
      const dropNearPickup =
        originalDrop != null && haversineKm(originalDrop, pickup) <= MAX_HEAD_TO_DROP_RADIUS_KM;
      const minsRemaining = estimateMinsRemaining(riderLoc, originalDrop);
      const tripNearlyDone = minsRemaining < MAX_MINS_REMAINING_FALLBACK;
      if (!dropNearPickup && !tripNearlyDone) continue;

      // Detour math: rider → newPickup → newDrop  vs.  rider → originalDrop.
      // If the originalDrop is unknown we treat the "no-batch" path as 0 km
      // (worst case for the rider, but unambiguous). Clamp at 0 — negatives
      // can happen when the new drop is actually closer than the original.
      const noBatchKm = originalDrop ? haversineKm(riderLoc, originalDrop) : 0;
      const batchKm = riderToPickup + haversineKm(pickup, newDrop);
      const detourKm = Math.max(0, batchKm - noBatchKm);
      if (detourKm > MAX_DETOUR_KM) continue;

      // Earnings: ₹10 base + ₹5 / detour km, rounded.
      const extraEarnings = Math.round(10 + 5 * detourKm);

      // Pickup ETA: 30 kph average → 2 minutes per km, ceil so we never under-promise.
      const pickupEtaMin = Math.ceil(riderToPickup * 2);

      candidates.push({
        riderId: r.id,
        expoPushToken: r.expoPushToken,
        detourKm,
        extraEarnings,
        pickupEtaMin,
      });
    }

    if (candidates.length === 0) return { invited: 0 };

    // 4. Top 3 by lowest detour — the riders for whom this is least painful.
    candidates.sort((a, b) => a.detourKm - b.detourKm);
    const top = candidates.slice(0, MAX_INVITES_PER_ORDER);

    // 5. Create the invitations. Each is independent; one duplicate-key race
    //    (rider already invited for this order) shouldn't kill the rest.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_SECONDS * 1000);

    let invited = 0;
    for (const c of top) {
      try {
        const inv = await prisma.batchInvitation.create({
          data: {
            orderId,
            riderId: c.riderId,
            detourKm: Number(c.detourKm.toFixed(2)),
            extraEarnings: new Prisma.Decimal(c.extraEarnings),
            pickupEtaMin: c.pickupEtaMin,
            invitedAt: now,
            expiresAt,
          },
        });
        invited++;

        // 6. Best-effort push. Errors are swallowed inside the helper.
        if (c.expoPushToken) {
          sendBatchInvitationPush({
            expoPushToken: c.expoPushToken,
            invitationId: inv.id,
            orderId,
            extraEarnings: c.extraEarnings,
          }).catch(() => {});
        }

        // 7. SSE fan-out on the rider's per-rider channel. Cast through unknown
        //    because the RealtimeEvent union is closed — we publish the batch
        //    payload as `data` so the rider app's already-open EventSource can
        //    react instantly without waiting for the 3-second poll.
        publish(
          `rider:${c.riderId}:batch-invitation`,
          {
            kind: 'order:new',
            orderId,
            branchId: order.branchId,
          }
        );
      } catch (err) {
        // Unique-constraint race (rider already had a pending invite for this
        // order) or a transient DB hiccup. Log and keep going for the others.
        log.error({ err, riderId: c.riderId, orderId }, 'batch invitation create failed');
      }
    }

    return { invited };
  } catch (err) {
    log.error({ err, orderId }, 'maybeOfferAsBatch threw');
    return { invited: 0 };
  }
}
