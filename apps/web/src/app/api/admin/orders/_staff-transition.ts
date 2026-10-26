/**
 * Rules for the STAFF order-transition route (admin board + kitchen board).
 *
 * transitionOrder() allows every edge the system needs (rider app, payment
 * reconciler, refunds). Staff must only drive the operational ones, so the
 * route allow-lists targets here (P0-3):
 *   - ACCEPTED / PREPARING / READY           — admin or kitchen
 *   - DELIVERED                              — only PICKUP / DINE_IN orders
 *                                              (delivery orders complete via the rider)
 *   - CANCELLED_BY_RESTAURANT                — tenant admin only (it can queue a refund)
 * Never: PAYMENT_* → RECEIVED (payment confirmation is the gateway's job), any
 * REFUND_* (only refundOrder / the reconciler), rider-funnel states, legacy
 * CANCELLED.
 */
import { OrderStatus, PaymentStatus, FulfillmentType, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { transitionOrder } from '@/server/orders';

export const STAFF_TARGETS: readonly OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED_BY_RESTAURANT,
];

/**
 * Null when allowed, else a user-facing reason + HTTP status (400 illegal
 * target, 403 role). `role` is the caller's membership role (or SUPER_ADMIN).
 */
export function staffTransitionError(
  order: { status: OrderStatus; fulfillmentType: FulfillmentType },
  next: OrderStatus,
  role: Role,
): { error: string; status: 400 | 403 } | null {
  if (order.status === next) return null; // idempotent replay
  if (!STAFF_TARGETS.includes(next)) {
    return { error: 'That status can’t be set from the order board.', status: 400 };
  }
  if (next === OrderStatus.DELIVERED && order.fulfillmentType === FulfillmentType.DELIVERY) {
    return { error: 'Delivery orders are completed by the rider.', status: 400 };
  }
  if (next === OrderStatus.CANCELLED_BY_RESTAURANT && role !== Role.ADMIN && role !== Role.SUPER_ADMIN) {
    return { error: 'Only a restaurant admin can reject or cancel an order.', status: 403 };
  }
  return null;
}

/**
 * After a restaurant cancellation: record who/why, and when money was already
 * captured chain into REFUND_PENDING so finance sees an action item and
 * refundOrder() can pay it out (mirrors the rider delivery-failure route).
 * Returns true when a refund was queued.
 */
export async function afterRestaurantCancel(orderId: string, actorId: string | undefined, note: string | undefined): Promise<boolean> {
  await prisma.order.update({
    where: { id: orderId },
    data: { cancelReason: note ?? 'Cancelled by restaurant', cancelledBy: actorId ?? null },
  });
  const captured = await prisma.payment.findFirst({
    where: { orderId, status: PaymentStatus.CAPTURED },
    select: { id: true },
  });
  if (!captured) return false;
  await transitionOrder(orderId, OrderStatus.REFUND_PENDING, {
    actorId,
    note: 'Auto-queued after restaurant cancellation',
  });
  return true;
}
