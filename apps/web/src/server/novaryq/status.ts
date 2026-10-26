/**
 * CONTRACT §3: apply a Novaryq POS order status to the Flavrly order.
 *
 * One table (planStatusAction), every move through transitionOrder (the order
 * state machine). Stale/out-of-order events — occurredAt older than the last
 * applied — are dropped by a conditional update on NovaryqOrderSync.lastStatusAt,
 * which is also the race guard between the inline webhook path and the worker.
 */
import { FulfillmentType, OrderStatus } from '@prisma/client';
import { prisma } from '../db';
import { log } from '../log';
import { transitionOrder } from '../orders';
import { sendNovaryqAlert } from './alerts';

export type StatusAction =
  | { kind: 'none'; reason: string }
  | { kind: 'transition'; steps: OrderStatus[] }
  | { kind: 'exception'; reason: string };

const KITCHEN_PATH: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY];
const TARGET: Record<string, OrderStatus> = {
  SENT: OrderStatus.ACCEPTED,
  IN_PREP: OrderStatus.PREPARING,
  READY: OrderStatus.READY,
};
/** States the order machine lets the restaurant cancel from (ALLOWED_NEXT). */
const RESTAURANT_CANCELLABLE: OrderStatus[] = [OrderStatus.RECEIVED, OrderStatus.ACCEPTED, OrderStatus.PREPARING];
const CANCELLED: OrderStatus[] = [
  OrderStatus.CANCELLED, OrderStatus.CANCELLED_BY_CUSTOMER, OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN, OrderStatus.REFUND_PENDING, OrderStatus.REFUND_INITIATED, OrderStatus.REFUNDED,
];
const PICKED_UP: OrderStatus[] = [
  OrderStatus.PICKED_UP, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.RIDER_REACHED_CUSTOMER, OrderStatus.DELIVERY_OTP_FAILED,
  OrderStatus.CUSTOMER_UNREACHABLE, OrderStatus.DELIVERY_FAILED, OrderStatus.DELIVERED,
];

export function planStatusAction(nqStatus: string, current: OrderStatus, fulfillment: FulfillmentType): StatusAction {
  const target = TARGET[nqStatus];
  if (target) {
    const from = current === OrderStatus.RECEIVED ? -1 : KITCHEN_PATH.indexOf(current);
    const to = KITCHEN_PATH.indexOf(target);
    if (from === -1 && current !== OrderStatus.RECEIVED) return { kind: 'none', reason: `already ${current}` };
    if (from >= to) return { kind: 'none', reason: `already ${current}` };
    return { kind: 'transition', steps: KITCHEN_PATH.slice(from + 1, to + 1) };
  }
  switch (nqStatus) {
    case 'COMPLETED':
      if (fulfillment === FulfillmentType.DELIVERY) return { kind: 'none', reason: 'rider completes delivery orders' };
      return current === OrderStatus.READY
        ? { kind: 'transition', steps: [OrderStatus.DELIVERED] }
        : { kind: 'none', reason: `COMPLETED while ${current}` };
    case 'VOIDED':
      if (RESTAURANT_CANCELLABLE.includes(current)) return { kind: 'transition', steps: [OrderStatus.CANCELLED_BY_RESTAURANT] };
      if (CANCELLED.includes(current)) return { kind: 'none', reason: `already ${current}` };
      return {
        kind: 'exception',
        reason: PICKED_UP.includes(current)
          ? `Voided in Novaryq after pickup (Flavrly order is ${current}); not auto-cancelled.`
          : `Voided in Novaryq while the Flavrly order is ${current}; the restaurant can no longer cancel it, ops must decide.`,
      };
    case 'REFUNDED':
      return { kind: 'none', reason: 'refunded in POS (finance follow-up)' };
    default:
      return { kind: 'none', reason: `no Flavrly action for ${nqStatus}` };
  }
}

export interface OrderStatusEvent {
  restaurantId: string;
  /** Flavrly Order.id (we push externalRef = Order.id). */
  externalRef: string;
  /** Novaryq order id, when present. */
  orderId?: string | null;
  status: string;
  occurredAt: string | Date;
}

export type ApplyOutcome =
  | 'applied' | 'noop' | 'exception'
  | 'ignored:unknown_order' | 'ignored:order_mismatch' | 'ignored:stale';

export async function applyOrderStatusEvent(ev: OrderStatusEvent): Promise<ApplyOutcome> {
  const sync = await prisma.novaryqOrderSync.findFirst({
    where: { orderId: ev.externalRef, restaurantId: ev.restaurantId },
    include: { order: { select: { id: true, code: true, status: true, fulfillmentType: true } } },
  });
  if (!sync) return 'ignored:unknown_order';
  if (sync.novaryqOrderId && ev.orderId && sync.novaryqOrderId !== ev.orderId) {
    log.warn({ orderId: sync.orderId, expected: sync.novaryqOrderId, got: ev.orderId }, 'novaryq.status.order_mismatch');
    return 'ignored:order_mismatch';
  }
  const occurredAt = new Date(ev.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw new Error('order status event has no valid occurredAt');

  // Record first (stale guard + race guard); a VOIDED marker also tells the cancel
  // hook in transitionOrder that Novaryq already voided, so no cancel is sent back.
  const guard = await prisma.novaryqOrderSync.updateMany({
    where: { id: sync.id, OR: [{ lastStatusAt: null }, { lastStatusAt: { lte: occurredAt } }] },
    data: { lastStatus: ev.status, lastStatusAt: occurredAt, ...(sync.novaryqOrderId || !ev.orderId ? {} : { novaryqOrderId: ev.orderId }) },
  });
  if (guard.count === 0) {
    log.info({ orderId: sync.orderId, status: ev.status, occurredAt }, 'novaryq.status.stale_ignored');
    return 'ignored:stale';
  }

  const plan = planStatusAction(ev.status, sync.order.status, sync.order.fulfillmentType);
  if (plan.kind === 'none') {
    if (ev.status === 'REFUNDED') log.info({ orderId: sync.orderId, code: sync.order.code }, 'novaryq.status.refunded_in_pos');
    return 'noop';
  }
  if (plan.kind === 'exception') {
    const open = await prisma.orderEscalation.findFirst({ where: { orderId: sync.orderId, type: 'POS_VOIDED', status: 'OPEN' } });
    if (!open) {
      await prisma.orderEscalation.create({
        data: { orderId: sync.orderId, type: 'POS_VOIDED', severity: 'HIGH', message: `${sync.order.code}: ${plan.reason}` },
      });
    }
    await sendNovaryqAlert({
      restaurantId: ev.restaurantId,
      kind: 'pos_voided',
      entityId: sync.orderId,
      subject: `Order ${sync.order.code} was voided in Novaryq POS`,
      text: `${plan.reason}\nOpen the order in Flavrly and decide whether to cancel or refund it.`,
    });
    log.warn({ orderId: sync.orderId, reason: plan.reason }, 'novaryq.status.exception');
    return 'exception';
  }
  for (const next of plan.steps) {
    await transitionOrder(sync.orderId, next, { scopeRestaurantId: ev.restaurantId, note: `Novaryq POS: ${ev.status}` });
  }
  return 'applied';
}
