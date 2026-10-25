/**
 * Loyalty programme constants — the single source for the order machine (earn), checkout (redeem
 * cap) and customer-facing copy, so the UI can never promise a different rate than the server pays.
 */

/** Points earned per full ₹100 of order subtotal, credited when the order is DELIVERED. */
export const LOYALTY_POINTS_PER_100 = 5;
/** Rupee value of one point when redeemed at checkout. */
export const LOYALTY_POINT_VALUE_RUPEES = 1;
/** Most points the checkout applies to a single order. */
export const LOYALTY_MAX_REDEEM_PER_ORDER = 200;

export function loyaltyPointsForSubtotal(subtotal: number): number {
  return Math.floor(Math.max(0, subtotal) / 100) * LOYALTY_POINTS_PER_100;
}

export function loyaltyEarnCopy(): string {
  return `Earn ${LOYALTY_POINTS_PER_100} pts for every ₹100 of food once your order is delivered. Redeem at checkout: 1 pt = ₹${LOYALTY_POINT_VALUE_RUPEES}, up to ${LOYALTY_MAX_REDEEM_PER_ORDER} pts per order.`;
}
