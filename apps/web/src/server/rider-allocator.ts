/**
 * Rider allocator: scores online riders by distance + current load + ETA.
 * v1: distance + load only (heuristic). v2 hook: pluggable scorer for ML.
 */

import { prisma } from './db';
import { haversineKm } from '@/lib/utils';
import { AssignmentStatus, OrderStatus, Prisma, RiderType } from '@prisma/client';
import { publish } from './realtime';
import { riderCanClaimOrder, resolveDedicatedGroup } from './rider-sourcing';
import { checkRiderEligibility } from './rider-eligibility';
import { computeBasePayout } from './payouts';
import { ensureCodCollection } from './rider-cod';
import { recordOrderEvent } from './dispatch/events';

export interface RiderScore {
  riderId: string;
  riderName: string;
  distanceKm: number;
  currentLoad: number;
  rating: number;
  score: number;
}

export type RiderScorer = (input: {
  rider: { id: string; lat: number | null; lng: number | null; load: number; rating: number };
  branch: { lat: number | null; lng: number | null };
  delivery: { lat: number | null; lng: number | null };
}) => number;

export const defaultScorer: RiderScorer = ({ rider, branch, delivery }) => {
  let dist = 0;
  if (rider.lat != null && rider.lng != null && branch.lat != null && branch.lng != null) {
    dist = haversineKm({ lat: rider.lat, lng: rider.lng }, { lat: branch.lat, lng: branch.lng });
  }
  // lower is better; weight load × 2km, rating reduces score (0..0.5km nudge)
  return dist + rider.load * 2 + (5 - rider.rating) * 0.5;
};

/**
 * Thrown by `assignRider` when the order or rider is not eligible. Carries an
 * HTTP status so the admin route can return it instead of a 500.
 */
export class RiderAssignError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'RiderAssignError';
  }
}

export async function suggestRiders(orderId: string, scorer: RiderScorer = defaultScorer): Promise<RiderScore[]> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { branch: { include: { restaurant: true } }, address: true }
  });
  // P1-10: candidates are every online, approved, active rider the restaurant's
  // dispatch policy allows — fleet riders have no branchId, so filtering on the
  // order's branch hid them entirely. Home-branch riders are still included.
  const riders = await prisma.riderProfile.findMany({
    where: {
      isOnline: true,
      approvedAt: { not: null },
      user: { deletedAt: null, suspendedAt: null },
      OR: [
        { branchId: order.branchId },
        { riderType: RiderType.FLEET },
        { riderType: RiderType.DEDICATED, dedicatedRestaurantId: { not: null } }
      ]
    },
    include: { user: { select: { name: true, phone: true } } },
    take: 200
  });
  const allowed: typeof riders = [];
  for (const r of riders) {
    const group = await resolveDedicatedGroup({ id: r.id, riderType: r.riderType, dedicatedRestaurantId: r.dedicatedRestaurantId });
    // Admin picks may skip the DEDICATED_FIRST fleet wait (see assignRider).
    if (riderCanClaimOrder(group, { ...order, readyAt: new Date(0) })) allowed.push(r);
  }
  const branchLoc = { lat: order.branch.latitude, lng: order.branch.longitude };
  const delivery = order.address ? { lat: order.address.latitude, lng: order.address.longitude } : branchLoc;

  return allowed
    .map((r) => {
      const score = scorer({
        rider: { id: r.id, lat: r.currentLat, lng: r.currentLng, load: r.currentLoad, rating: r.rating },
        branch: branchLoc,
        delivery
      });
      const distance = r.currentLat != null && r.currentLng != null && branchLoc.lat != null && branchLoc.lng != null
        ? haversineKm({ lat: r.currentLat, lng: r.currentLng }, { lat: branchLoc.lat as number, lng: branchLoc.lng as number })
        : 0;
      return {
        riderId: r.id,
        riderName: r.user.name ?? r.user.phone ?? r.id,
        distanceKm: Math.round(distance * 10) / 10,
        currentLoad: r.currentLoad,
        rating: r.rating,
        score
      } satisfies RiderScore;
    })
    .sort((a, b) => a.score - b.score);
}

export async function autoAssign(orderId: string): Promise<{ riderId: string } | null> {
  const candidates = await suggestRiders(orderId);
  const best = candidates[0];
  if (!best) return null;
  await assignRider(orderId, best.riderId);
  return { riderId: best.riderId };
}

/**
 * Admin/dispatcher assignment (P1-10).
 *   - order must be ACCEPTED/PREPARING/READY and not already picked up;
 *   - the rider must pass `checkRiderEligibility` (approved, active account,
 *     online, dispatch policy — fleet fallback wait waived for an explicit
 *     admin pick — KYC, concurrent-order cap);
 *   - re-assigning from another rider frees that rider's load slot in the same
 *     transaction (single winner on the previous assignment's status);
 *   - the payout is computed for the new rider (previously ₹0), and a COD
 *     order's CodCollection follows the rider.
 * Throws RiderAssignError with an HTTP status on any rule violation.
 */
export async function assignRider(orderId: string, riderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { assignment: true, branch: { include: { restaurant: true } } }
  });
  const eligibleStatuses: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY];
  if (!eligibleStatuses.includes(order.status)) {
    throw new RiderAssignError('Order is not eligible for rider assignment', 409, 'order_state');
  }
  const prev = order.assignment;
  if (prev && prev.status === AssignmentStatus.PICKED_UP) {
    throw new RiderAssignError('The current rider already has the food — reassignment is not possible.', 409, 'picked_up');
  }
  const prevActive = prev && (prev.status === AssignmentStatus.PENDING || prev.status === AssignmentStatus.ACCEPTED);
  if (prevActive && prev.riderId === riderId) return prev; // already theirs

  const eligible = await checkRiderEligibility(riderId, order, { requireOnline: true, ignoreFleetFallbackWindow: true });
  if (!eligible.ok) throw new RiderAssignError(eligible.message, eligible.status, eligible.code);

  const payout = await computeBasePayout(orderId, { riderId });
  const earnings = {
    baseEarningsAmt: new Prisma.Decimal(payout.baseAmount),
    bonusAmt: new Prisma.Decimal(+(payout.payout - payout.baseAmount).toFixed(2)),
    earningsAmt: new Prisma.Decimal(payout.payout),
    tipAmt: new Prisma.Decimal(0)
  };

  const a = await prisma.$transaction(async (tx) => {
    let assn;
    if (prev) {
      // Single winner: only replace the row in the state we validated.
      const swapped = await tx.riderAssignment.updateMany({
        where: { id: prev.id, status: prev.status },
        data: {
          riderId,
          status: AssignmentStatus.PENDING,
          assignedAt: new Date(),
          acceptedAt: null,
          claimedAt: null,
          pickedUpAt: null,
          deliveredAt: null,
          deliveryOtpAttempts: 0,
          notes: null,
          ...earnings
        }
      });
      if (swapped.count === 0) throw new RiderAssignError('The order changed while assigning — refresh and try again.', 409, 'conflict');
      if (prevActive) {
        await tx.riderProfile.updateMany({
          where: { id: prev.riderId, currentLoad: { gt: 0 } },
          data: { currentLoad: { decrement: 1 } }
        });
      }
      assn = await tx.riderAssignment.findUniqueOrThrow({ where: { id: prev.id } });
    } else {
      assn = await tx.riderAssignment.create({
        data: { orderId, riderId, status: AssignmentStatus.PENDING, ...earnings }
      });
    }
    await tx.riderProfile.update({ where: { id: riderId }, data: { currentLoad: { increment: 1 } } });
    await ensureCodCollection(tx, orderId, riderId);
    return assn;
  });
  if (prevActive && prev) publish(`rider:${prev.riderId}`, { kind: 'status', orderId, status: order.status, at: new Date().toISOString() });
  publish(`rider:${riderId}`, { kind: 'assigned', orderId, riderId });
  publish(`order:${orderId}`, { kind: 'assigned', orderId, riderId });
  await recordOrderEvent({ orderId, type: 'ASSIGNED', source: 'ADMIN', riderId, meta: { via: 'assign' } });
  return a;
}
