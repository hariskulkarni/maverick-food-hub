import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { AssignmentStatus, OrderEventSource, OrderEventType, OrderStatus } from '@prisma/client';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { RIDER_PICKUP_ORDER_STATES } from '@/server/rider-delivery-rules';
import { recordOrderEvent } from '@/server/dispatch/events';
import { isReleasedForDispatch, PRE_READY_STATUSES } from '@/server/dispatch/jit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * "I have the food." P1-7 guards:
 *   - assignment must be ACCEPTED (PICKED_UP again is an idempotent no-op);
 *   - the order must be READY or a later rider-leg state — EXCEPT a JIT order
 *     (released to riders while still ACCEPTED/PREPARING): there the hand-over
 *     itself proves the food is ready, so the order is advanced
 *     → PREPARING → READY (event source RIDER) before going out. A pre-ready
 *     order that JIT did NOT release (e.g. assigned early) is refused.
 * The order moves to OUT_FOR_DELIVERY first (which texts the customer their
 * hand-over code), then the assignment flips ACCEPTED → PICKED_UP with a
 * conditional write, and a PICKED_UP telemetry event is recorded.
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

  const preReady = PRE_READY_STATUSES.includes(a.order.status);
  const jitPickup = preReady && (await isReleasedForDispatch(a.order.id));
  if (!jitPickup && !RIDER_PICKUP_ORDER_STATES.includes(a.order.status)) {
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

  const opts = { actorId: session.user.id, eventSource: OrderEventSource.RIDER };
  try {
    if (jitPickup) {
      if (a.order.status === OrderStatus.ACCEPTED) {
        await transitionOrder(a.order.id, OrderStatus.PREPARING, { ...opts, note: 'Implied by rider pickup' });
      }
      await transitionOrder(a.order.id, OrderStatus.READY, { ...opts, note: 'Food ready implied by rider pickup' });
    }
    if (a.order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      await transitionOrder(a.order.id, OrderStatus.OUT_FOR_DELIVERY, opts);
    }
  } catch (e) {
    if (e instanceof OrderTransitionError) {
      return Response.json({ error: 'This order can no longer be picked up.' }, { status: 409 });
    }
    throw e;
  }
  await prisma.riderAssignment.updateMany({
    where: { id: a.id, status: AssignmentStatus.ACCEPTED },
    data: { status: AssignmentStatus.PICKED_UP, pickedUpAt: new Date() }
  });
  await recordOrderEvent({
    orderId: a.orderId,
    type: OrderEventType.PICKED_UP,
    source: OrderEventSource.RIDER,
    actorId: session.user.id,
    riderId: profile.id,
    lat: profile.currentLat,
    lng: profile.currentLng,
  });
  const u = await prisma.riderAssignment.findUnique({ where: { id: a.id } });
  return Response.json(u);
}
