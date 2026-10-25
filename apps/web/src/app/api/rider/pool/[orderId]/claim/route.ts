/**
 * POST /api/rider/pool/[orderId]/claim
 * The rider takes an order from the pool. Idempotent: if the order is already
 * claimed by someone else, returns 409.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { AssignmentStatus, OrderStatus } from '@prisma/client';
import { transitionOrder } from '@/server/orders';
import { computeBasePayout } from '@/server/payouts';
import { publish } from '@/server/realtime';
import { riderCanClaimOrder, resolveDedicatedGroup } from '@/server/rider-sourcing';
import { OrderEventSource, OrderEventType, FulfillmentType } from '@prisma/client';
import { recordOrderEvent } from '@/server/dispatch/events';
import { isReleasedForDispatch, PRE_READY_STATUSES } from '@/server/dispatch/jit';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile || !profile.approvedAt) return new Response('Rider not approved', { status: 403 });
  if (!profile.isOnline) return new Response('Must be online to claim', { status: 400 });

  // Include branch.restaurant so the dispatch engine can check whether this
  // rider type is allowed to claim this restaurant's orders.
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { assignment: true, branch: { include: { restaurant: true } } }
  });
  if (!order) return new Response('Order not found', { status: 404 });
  if (order.assignment) return new Response('Order already claimed', { status: 409 });
  if (order.status !== OrderStatus.READY) {
    // JIT: a DELIVERY order still being prepared is claimable once the JIT
    // sweep has released it to riders (setting on; see server/dispatch/jit.ts).
    const jitReleased =
      PRE_READY_STATUSES.includes(order.status) &&
      order.fulfillmentType === FulfillmentType.DELIVERY &&
      (await isReleasedForDispatch(orderId));
    if (!jitReleased) return new Response('Order not in pool yet', { status: 400 });
  }

  // Enforce the restaurant's rider-dispatch policy: a fleet rider can't grab a
  // dedicated-only order, a dedicated rider can't grab a fleet-only order, and
  // for DEDICATED_FIRST the fleet must wait out the fallback window. We resolve
  // the rider's group first so a rider dedicated to any restaurant in a group
  // may claim orders from any restaurant in that same group.
  const groupProfile = await resolveDedicatedGroup(profile);
  if (!riderCanClaimOrder(groupProfile, order)) {
    return new Response('This order is not available to you', { status: 403 });
  }

  // Pass riderId so any rider-specific RiderPayoutOverride is applied at the
  // moment of claim. Pool listings use the platform default so all riders see
  // the same baseline; the personalised number is locked in at this point.
  const payout = await computeBasePayout(orderId, { riderId: profile.id });
  // Atomic claim
  try {
    const assignment = await prisma.$transaction(async (tx) => {
      const a = await tx.riderAssignment.create({
        data: {
          orderId,
          riderId: profile.id,
          status: AssignmentStatus.ACCEPTED,
          claimedAt: new Date(),
          assignedAt: new Date(),
          acceptedAt: new Date(),
          baseEarningsAmt: payout.baseAmount as any,
          bonusAmt: (payout.payout - payout.baseAmount) as any,
          earningsAmt: payout.payout as any
        }
      });
      await tx.riderProfile.update({ where: { id: profile.id }, data: { currentLoad: { increment: 1 } } });
      return a;
    });
    publish('rider:pool', { kind: 'order:claimed', orderId });
    publish(`order:${orderId}`, { kind: 'assigned', orderId, riderId: profile.id });
    await recordOrderEvent({
      orderId,
      type: OrderEventType.ASSIGNED,
      source: OrderEventSource.RIDER,
      actorId: session.user.id,
      riderId: profile.id,
      lat: profile.currentLat,
      lng: profile.currentLng,
      meta: { via: 'pool', preReady: order.status !== OrderStatus.READY },
    });
    return Response.json(assignment);
  } catch (e) {
    // Unique constraint violation → race lost
    return new Response('Order just got claimed by another rider', { status: 409 });
  }
}
