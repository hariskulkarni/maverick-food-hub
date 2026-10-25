/**
 * POST /api/admin/orders/[id]/food-ready
 *
 * Kitchen's single-tap "Food ready" (kitchen board + admin orders board).
 * Moves an ACCEPTED/PREPARING order to READY through transitionOrder (which
 * writes the FOOD_READY OrderEvent and runs the normal READY dispatch), and
 * writes an audit row. Idempotent: an order already READY or further along
 * returns 200 { alreadyReady: true } without touching it.
 *
 * Auth: KITCHEN / ADMIN of the owning restaurant, or SUPER_ADMIN (C12 scope).
 */
import { NextRequest } from 'next/server';
import { OrderStatus } from '@prisma/client';
import { prisma } from '@/server/db';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { audit } from '@/server/audit';
import { sourceForRole } from '@/server/dispatch/events';
import { requireOwnedOrder } from '../../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRE_READY: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PREPARING];
const NOT_YET: OrderStatus[] = [OrderStatus.PAYMENT_PENDING, OrderStatus.PAYMENT_FAILED, OrderStatus.RECEIVED];
const CLOSED: OrderStatus[] = [
  OrderStatus.CANCELLED, OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.CANCELLED_BY_CUSTOMER, OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.REFUND_PENDING, OrderStatus.REFUND_INITIATED, OrderStatus.REFUNDED,
];

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await requireOwnedOrder(id);
  if ('error' in scope) return scope.error;
  const role = (scope.session.user as { role?: string }).role ?? null;
  const actorId = scope.session.user?.id ?? null;

  const order = await prisma.order.findFirst({
    where: scope.scopeRestaurantId ? { id, branch: { restaurantId: scope.scopeRestaurantId } } : { id },
    select: { id: true, code: true, status: true, branch: { select: { restaurantId: true } } },
  });
  if (!order) return Response.json({ error: 'Order not found.' }, { status: 404 });
  if (NOT_YET.includes(order.status)) {
    return Response.json({ error: 'Accept the order before marking food ready.', reason: 'not_accepted' }, { status: 409 });
  }
  if (CLOSED.includes(order.status)) {
    return Response.json({ error: 'This order is closed.', reason: 'closed' }, { status: 409 });
  }
  if (!PRE_READY.includes(order.status)) {
    return Response.json({ ok: true, alreadyReady: true, status: order.status });
  }

  const opts = {
    actorId: actorId ?? undefined,
    scopeRestaurantId: scope.scopeRestaurantId ?? undefined,
    eventSource: sourceForRole(role),
  };
  try {
    if (order.status === OrderStatus.ACCEPTED) {
      await transitionOrder(id, OrderStatus.PREPARING, { ...opts, note: 'Food ready tapped (prep start implied)' });
    }
    await transitionOrder(id, OrderStatus.READY, { ...opts, note: 'Food ready' });
  } catch (e) {
    if (!(e instanceof OrderTransitionError)) throw e;
    // A concurrent tap (other device) may have won the race — that's success.
    const now = await prisma.order.findUnique({ where: { id }, select: { status: true } });
    if (now && !PRE_READY.includes(now.status) && !CLOSED.includes(now.status)) {
      return Response.json({ ok: true, alreadyReady: true, status: now.status });
    }
    return Response.json({ error: e.message, reason: 'illegal_transition' }, { status: 409 });
  }

  await audit('order.food_ready', {
    actorId,
    actorRole: role,
    restaurantId: order.branch.restaurantId,
    entityType: 'Order',
    entityId: id,
    before: { status: order.status },
    after: { status: OrderStatus.READY, code: order.code },
  });
  return Response.json({ ok: true, alreadyReady: false, status: OrderStatus.READY });
}
