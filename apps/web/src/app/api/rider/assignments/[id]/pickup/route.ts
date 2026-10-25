import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { AssignmentStatus, OrderStatus } from '@prisma/client';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { RIDER_PICKUP_ORDER_STATES } from '@/server/rider-delivery-rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "I have the food." P1-7 guards:
 *   - assignment must be ACCEPTED (PICKED_UP again is an idempotent no-op);
 *   - the kitchen must have marked the order READY (or a later rider-leg
 *     state) — a PREPARING order is refused with a clear message.
 * The order moves to OUT_FOR_DELIVERY first (which texts the customer their
 * hand-over code), then the assignment flips ACCEPTED → PICKED_UP with a
 * conditional write.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id }, include: { order: { select: { id: true, status: true } } } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  if (a.status === AssignmentStatus.PICKED_UP) return Response.json(a);
  if (a.status !== AssignmentStatus.ACCEPTED) {
    return Response.json({ error: 'Accept this order before picking it up.' }, { status: 409 });
  }
  if (!RIDER_PICKUP_ORDER_STATES.includes(a.order.status)) {
    const notReadyYet: OrderStatus[] = [OrderStatus.RECEIVED, OrderStatus.ACCEPTED, OrderStatus.PREPARING];
    return Response.json(
      {
        error: notReadyYet.includes(a.order.status)
          ? "The restaurant hasn't marked this order ready yet."
          : 'This order can no longer be picked up.'
      },
      { status: 409 }
    );
  }

  if (a.order.status !== OrderStatus.OUT_FOR_DELIVERY) {
    try {
      await transitionOrder(a.order.id, OrderStatus.OUT_FOR_DELIVERY, { actorId: session.user.id });
    } catch (e) {
      if (e instanceof OrderTransitionError) {
        return Response.json({ error: 'This order can no longer be picked up.' }, { status: 409 });
      }
      throw e;
    }
  }
  await prisma.riderAssignment.updateMany({
    where: { id: a.id, status: AssignmentStatus.ACCEPTED },
    data: { status: AssignmentStatus.PICKED_UP, pickedUpAt: new Date() }
  });
  const u = await prisma.riderAssignment.findUnique({ where: { id: a.id } });
  return Response.json(u);
}
