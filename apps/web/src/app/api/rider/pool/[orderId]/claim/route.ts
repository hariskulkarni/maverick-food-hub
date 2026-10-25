/**
 * POST /api/rider/pool/[orderId]/claim
 * The rider takes an order from the pool. 409 if another rider got it first.
 *
 * Eligibility (approval, account state, dispatch policy, KYC, concurrent-order
 * cap) lives in `checkRiderEligibility`. A COD order gets its CodCollection row
 * in the same transaction as the assignment (P0-4).
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { AssignmentStatus, OrderStatus, Prisma } from '@prisma/client';
import { computeBasePayout } from '@/server/payouts';
import { publish } from '@/server/realtime';
import { checkRiderEligibility } from '@/server/rider-eligibility';
import { ensureCodCollection } from '@/server/rider-cod';
import { log } from '@/server/log';
import { OrderEventSource, OrderEventType, FulfillmentType } from '@prisma/client';
import { recordOrderEvent } from '@/server/dispatch/events';
import { isReleasedForDispatch, PRE_READY_STATUSES } from '@/server/dispatch/jit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAKEN = 'Order just got claimed by another rider';

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

  const eligible = await checkRiderEligibility(profile.id, order, { requireOnline: true });
  if (!eligible.ok) {
    return Response.json({ error: eligible.message, code: eligible.code }, { status: eligible.status });
  }

  // Pass riderId so any rider-specific RiderPayoutOverride is applied at the
  // moment of claim. Pool listings use the platform default so all riders see
  // the same baseline; the personalised number is locked in at this point.
  const payout = await computeBasePayout(orderId, { riderId: profile.id });
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
      await ensureCodCollection(tx, orderId, profile.id);
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
    // P2-22: only a unique-constraint violation means the race was lost;
    // anything else is a real failure and must not be disguised as one.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new Response(TAKEN, { status: 409 });
    }
    log.error({ err: (e as Error).message, orderId, riderId: profile.id }, 'pool claim failed');
    return Response.json({ error: 'Could not claim this order. Please try again.' }, { status: 500 });
  }
}
