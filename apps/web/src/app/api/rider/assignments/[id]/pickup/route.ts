import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { AssignmentStatus, OrderEventSource, OrderEventType, OrderStatus } from '@prisma/client';
import { transitionOrder } from '@/server/orders';
import { recordOrderEvent } from '@/server/dispatch/events';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });
  const u = await prisma.riderAssignment.update({ where: { id: a.id }, data: { status: AssignmentStatus.PICKED_UP, pickedUpAt: new Date() } });
  await recordOrderEvent({
    orderId: a.orderId,
    type: OrderEventType.PICKED_UP,
    source: OrderEventSource.RIDER,
    actorId: session.user.id,
    riderId: profile.id,
    lat: profile.currentLat,
    lng: profile.currentLng,
  });
  const order = await prisma.order.findUnique({ where: { id: a.orderId } });
  const opts = { actorId: session.user.id, eventSource: OrderEventSource.RIDER };
  const preReady = order?.status === OrderStatus.ACCEPTED || order?.status === OrderStatus.PREPARING;
  // A JIT-invited rider can hold the food before the kitchen tapped "Food
  // ready": the hand-over itself proves it, so advance the order to READY
  // first (FOOD_READY source RIDER — excluded from prep stats and tap rate).
  if (order?.status === OrderStatus.ACCEPTED) {
    await transitionOrder(order.id, OrderStatus.PREPARING, { ...opts, note: 'Implied by rider pickup' });
  }
  if (order && preReady) {
    await transitionOrder(order.id, OrderStatus.READY, { ...opts, note: 'Food ready implied by rider pickup' });
  }
  // also progress order to OUT_FOR_DELIVERY if it's still READY
  if (order && (order.status === OrderStatus.READY || preReady)) {
    await transitionOrder(order.id, OrderStatus.OUT_FOR_DELIVERY, opts);
  }
  return Response.json(u);
}
