/**
 * Pure helpers for the restaurant order boards (admin + kitchen).
 */

/**
 * The hand-over action for a READY order that has no rider leg. PICKUP and
 * DINE_IN orders finish READY → DELIVERED (ALLOWED_NEXT in server/orders.ts);
 * DELIVERY orders are completed by the rider's OTP hand-over instead, so they
 * get no button here.
 */
export function completionAction(o: { status: string; fulfillmentType?: string | null }): { next: 'DELIVERED'; label: string } | null {
  if (o.status !== 'READY') return null;
  if (o.fulfillmentType === 'PICKUP') return { next: 'DELIVERED', label: 'Mark collected' };
  if (o.fulfillmentType === 'DINE_IN') return { next: 'DELIVERED', label: 'Mark served — complete' };
  return null;
}

/** True when the order needs a rider (DELIVERY, or unspecified legacy rows). */
export function needsRider(o: { fulfillmentType?: string | null }): boolean {
  return !o.fulfillmentType || o.fulfillmentType === 'DELIVERY';
}

/**
 * Every cancelled order status. Reject still writes legacy CANCELLED while
 * customer/restaurant/admin cancels write CANCELLED_BY_*; filters must match
 * all of them.
 */
export const CANCELLED_STATUSES = ['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN'] as const;

export function isCancelledStatus(status: string): boolean {
  return (CANCELLED_STATUSES as readonly string[]).includes(status);
}
