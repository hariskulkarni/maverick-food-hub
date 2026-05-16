/**
 * POST /api/rider/batch-invitations/[id]/accept
 *
 * The rider tapped ACCEPT in the modal. We need to:
 *   1. Verify ownership + that the invitation is still PENDING & not expired.
 *   2. Mark this invitation ACCEPTED.
 *   3. Cancel every OTHER PENDING invitation on the same orderId
 *      (reason: 'taken-by-another') so they vanish from the other riders'
 *      modals on their next tick.
 *   4. Create a RiderAssignment in ACCEPTED state, with payout values matching
 *      what the normal pool claim would set.
 *   5. Transition the Order to OUT_FOR_DELIVERY (the batch flow skips the
 *      RIDER_ASSIGNED interstitial — by the time the rider accepts a batch
 *      the food is implicitly ready and they're already mid-trip).
 *
 * Returns 409 on:
 *   - invitation already accepted/declined/cancelled/expired by the sweeper
 *   - the order was already claimed by another rider (race condition)
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import {
  AssignmentStatus,
  BatchInvitationStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { transitionOrder } from '@/server/orders';
import { computeBasePayout } from '@/server/payouts';
import { publish } from '@/server/realtime';
import { log } from '@/server/log';
import { requireRider } from '../../_helpers';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const guard = await requireRider();
  if (!guard.ok) return guard.response;
  const profileId = guard.rider.profileId;

  // Load + ownership check.
  const inv = await prisma.batchInvitation.findUnique({ where: { id } });
  if (!inv || inv.riderId !== profileId) {
    return new Response('Not found', { status: 404 });
  }
  if (inv.status !== BatchInvitationStatus.PENDING) {
    return new Response('Invitation no longer pending', { status: 409 });
  }
  if (inv.expiresAt.getTime() <= Date.now()) {
    return new Response('Invitation expired', { status: 409 });
  }

  // Compute payout outside the txn — `computeBasePayout` runs its own queries
  // and would needlessly extend the txn lifetime if held inside.
  const payout = await computeBasePayout(inv.orderId, { riderId: profileId });

  let assignmentId: string;
  try {
    assignmentId = await prisma.$transaction(async (tx) => {
      // Re-verify inside the txn so concurrent accepts can't both win.
      const fresh = await tx.batchInvitation.findUnique({ where: { id } });
      if (!fresh || fresh.status !== BatchInvitationStatus.PENDING) {
        throw new Error('CONFLICT:invitation');
      }

      // Has someone already claimed this order via a parallel path
      // (pool, dispatcher, sibling batch)?
      const existingAssign = await tx.riderAssignment.findUnique({
        where: { orderId: fresh.orderId },
      });
      if (existingAssign) {
        throw new Error('CONFLICT:order');
      }

      const now = new Date();

      // 1. Mark this invitation ACCEPTED.
      await tx.batchInvitation.update({
        where: { id: fresh.id },
        data: { status: BatchInvitationStatus.ACCEPTED, respondedAt: now },
      });

      // 2. Cancel siblings on the same order (every other rider's pending row).
      await tx.batchInvitation.updateMany({
        where: {
          orderId: fresh.orderId,
          status: BatchInvitationStatus.PENDING,
          NOT: { id: fresh.id },
        },
        data: {
          status: BatchInvitationStatus.CANCELLED,
          respondedAt: now,
          reason: 'taken-by-another',
        },
      });

      // 3. Create the assignment. Same payout fields as the normal pool claim.
      const assignment = await tx.riderAssignment.create({
        data: {
          orderId: fresh.orderId,
          riderId: profileId,
          status: AssignmentStatus.ACCEPTED,
          claimedAt: now,
          assignedAt: now,
          acceptedAt: now,
          baseEarningsAmt: new Prisma.Decimal(payout.baseAmount),
          // Add the batch bonus on top of the normal bonus delta — pricing-wise
          // they're both "above the base," so they live in the same column.
          bonusAmt: new Prisma.Decimal(
            payout.payout - payout.baseAmount + Number(fresh.extraEarnings.toString())
          ),
          earningsAmt: new Prisma.Decimal(
            payout.payout + Number(fresh.extraEarnings.toString())
          ),
        },
      });

      await tx.riderProfile.update({
        where: { id: profileId },
        data: { currentLoad: { increment: 1 } },
      });

      return assignment.id;
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === 'CONFLICT:invitation' || msg === 'CONFLICT:order') {
      return new Response('This order was just taken by another rider', { status: 409 });
    }
    // Unique constraint on RiderAssignment.orderId — same race outcome.
    if ((e as { code?: string }).code === 'P2002') {
      return new Response('This order was just taken by another rider', { status: 409 });
    }
    log.error({ err: e, invitationId: id }, 'batch accept failed');
    return new Response('Could not accept the batch', { status: 500 });
  }

  // Transition the order outside the txn — `transitionOrder` writes status
  // events, publishes realtime events and dispatches SMS, and we don't want
  // those side effects rolled into the assignment-create txn. Idempotent.
  try {
    const order = await prisma.order.findUnique({ where: { id: inv.orderId } });
    if (order && order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      await transitionOrder(inv.orderId, OrderStatus.OUT_FOR_DELIVERY, {
        actorId: guard.rider.userId,
        note: 'Batched onto rider via BatchInvitation',
      });
    }
  } catch (e) {
    // Transition failure must not undo the accept — we log and continue. The
    // rider's queue still has the new assignment; admin can re-sync status if
    // the order machine got into a weird state.
    log.error({ err: e, invitationId: id, orderId: inv.orderId }, 'batch accept transition failed');
  }

  publish('rider:pool', { kind: 'order:claimed', orderId: inv.orderId });
  publish(`order:${inv.orderId}`, {
    kind: 'assigned',
    orderId: inv.orderId,
    riderId: profileId,
  });

  return Response.json({ ok: true, assignmentId, orderId: inv.orderId });
}
