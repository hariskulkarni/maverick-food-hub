/**
 * The ONE definition of "an order that counts as revenue", shared by the
 * dashboard, reports and exports (P1-6).
 *
 * An INCLUDE-list (not an exclude-list) so a new status never silently counts
 * as money. Counts orders the restaurant has (or is) fulfilling with payment
 * secured (or COD in hand): RECEIVED through DELIVERED, incl. in-flight
 * delivery exceptions that may still be handed over.
 *
 * Excluded: PAYMENT_PENDING / PAYMENT_FAILED (no money), every CANCELLED_*,
 * DELIVERY_FAILED (terminal, refund path) and the REFUND_* funnel.
 */
import { OrderStatus } from '@prisma/client';

export const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.RECEIVED,
  OrderStatus.ACCEPTED,
  OrderStatus.PREPARING,
  OrderStatus.READY,
  OrderStatus.RIDER_ASSIGNED,
  OrderStatus.RIDER_REACHED_RESTAURANT,
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.RIDER_REACHED_CUSTOMER,
  OrderStatus.DELIVERY_OTP_FAILED,
  OrderStatus.CUSTOMER_UNREACHABLE,
  OrderStatus.DELIVERED,
];

/** Prisma `status` filter for revenue-counting orders. */
export const REVENUE_STATUS_FILTER = { in: REVENUE_STATUSES };

/** Statuses that mean the order was cancelled at some point (incl. refunds that followed a cancellation are matched via cancelledAt). */
export const CANCELLED_STATUSES: OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.CANCELLED_BY_CUSTOMER,
  OrderStatus.CANCELLED_BY_RESTAURANT,
  OrderStatus.CANCELLED_BY_ADMIN,
];
