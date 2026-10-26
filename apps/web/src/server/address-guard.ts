/**
 * Customer audit P1-13: Order.addressId points at the live Address row (FK SET NULL on delete), so
 * deleting or re-pointing an address while an order is still on its way strips or MOVES that order's
 * delivery destination for the kitchen and rider. Refuse those changes while any order using the
 * address (or, for account deletion, any order of the customer) is still active.
 */
import { OrderStatus } from '@prisma/client';
import { prisma } from './db';

/** Orders in these states no longer need their delivery address. */
export const ADDRESS_FREE_STATUSES: OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.DELIVERY_FAILED,
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
  OrderStatus.REFUND_PENDING,
  OrderStatus.REFUND_INITIATED,
  OrderStatus.REFUNDED,
];

export const ADDRESS_IN_USE_MESSAGE = 'This address is being used by an order that is still in progress. You can change it once the order is completed.';

export async function addressHasActiveOrder(addressId: string): Promise<boolean> {
  return (await prisma.order.count({ where: { addressId, status: { notIn: ADDRESS_FREE_STATUSES } } })) > 0;
}

export async function customerHasActiveOrder(customerId: string): Promise<boolean> {
  return (await prisma.order.count({ where: { customerId, status: { notIn: ADDRESS_FREE_STATUSES } } })) > 0;
}

/** Fields that define where food goes; label/default flags can always change. */
const LOCATION_FIELDS = ['line1', 'line2', 'city', 'state', 'postalCode', 'country', 'latitude', 'longitude', 'landmark', 'floor', 'instructions'] as const;

export function changesLocation(existing: Record<string, unknown>, patch: Record<string, unknown>): boolean {
  const norm = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null);
  return LOCATION_FIELDS.some((k) => patch[k] !== undefined && norm(patch[k]) !== norm(existing[k]));
}
