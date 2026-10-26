/**
 * Thin, never-throwing glue between the order state machine (orders.ts) and
 * dispatch telemetry. Loaded lazily from transitionOrder.
 */
import { FulfillmentType, OrderEventSource, OrderStatus } from '@prisma/client';
import { prisma } from '../db';
import { eventTypeForStatus, recordOrderEvent, safeWarn } from './events';
import { onFoodReady as jitOnFoodReady, planDispatchOnAccept } from './jit';

export async function onOrderTransition(i: {
  orderId: string;
  next: OrderStatus;
  fulfillmentType: FulfillmentType;
  source: OrderEventSource;
  actorId: string | null;
  note: string | null;
}): Promise<void> {
  try {
    const type = eventTypeForStatus(i.next);
    if (type) {
      await recordOrderEvent({
        orderId: i.orderId,
        type,
        source: i.source,
        actorId: i.actorId,
        meta: { status: i.next, ...(i.note ? { note: i.note.slice(0, 200) } : {}) },
      });
    }
    if (i.next === OrderStatus.ACCEPTED && i.fulfillmentType === FulfillmentType.DELIVERY) {
      await planDispatchOnAccept(i.orderId);
    }
  } catch (e) {
    safeWarn({ err: (e as Error).message, orderId: i.orderId }, 'dispatch telemetry hook failed');
  }
}

export async function onFoodReady(orderId: string): Promise<{ alreadyNotified: boolean }> {
  return jitOnFoodReady(orderId);
}

export async function hasAssignment(orderId: string): Promise<boolean> {
  try {
    const a = await prisma.riderAssignment.findUnique({ where: { orderId }, select: { id: true } });
    return !!a;
  } catch {
    return false;
  }
}
