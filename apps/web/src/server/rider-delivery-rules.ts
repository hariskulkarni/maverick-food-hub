/**
 * Shared state rules for the rider delivery flow (accept → pickup → deliver /
 * fail). Kept out of route files because Next.js route modules may only export
 * HTTP handlers.
 */
import { OrderStatus } from '@prisma/client';

/** P1-5: wrong hand-over codes allowed per assignment before it locks. */
export const MAX_DELIVERY_OTP_ATTEMPTS = 5;

/** Order states from which the rider may hand over (the food is out for delivery). */
export const RIDER_DELIVERABLE_ORDER_STATES: OrderStatus[] = [
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.RIDER_REACHED_CUSTOMER,
  OrderStatus.DELIVERY_OTP_FAILED,
  OrderStatus.CUSTOMER_UNREACHABLE,
];

/**
 * P1-7: order states in which the rider may mark the food picked up. The
 * kitchen must have marked it READY (or a later rider-leg state); PREPARING /
 * ACCEPTED orders are refused so the customer's OTP SMS only goes out when the
 * food actually leaves.
 */
export const RIDER_PICKUP_ORDER_STATES: OrderStatus[] = [
  OrderStatus.READY,
  OrderStatus.RIDER_ASSIGNED,
  OrderStatus.RIDER_REACHED_RESTAURANT,
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
];
