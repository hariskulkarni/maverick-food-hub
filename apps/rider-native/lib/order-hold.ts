/**
 * Order-level states that override the assignment's own status on screen.
 *
 * The rider's assignment stays PICKED_UP while support handles an exception,
 * so screens must look at `order.status` too:
 *   - CUSTOMER_UNREACHABLE: rider reported the customer unreachable; support
 *     has a live-ops escalation and will instruct the rider. The order can
 *     still be delivered with the customer's code if they turn up.
 *   - DELIVERY_FAILED / CANCELLED_* / REFUND_*: support closed the order
 *     without a hand-over. Nothing more to do in the app.
 */
import type { Assignment } from './api';

export type OrderHold = 'unreachable' | 'closed' | null;

const CLOSED = new Set([
  'DELIVERY_FAILED',
  'CANCELLED',
  'CANCELLED_BY_ADMIN',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_RESTAURANT',
  'REFUND_PENDING',
  'REFUND_INITIATED',
  'REFUNDED',
]);

export function orderHold(a: Pick<Assignment, 'status' | 'order'>): OrderHold {
  if (a.status === 'DELIVERED') return null;
  const s = a.order?.status;
  if (s === 'CUSTOMER_UNREACHABLE') return 'unreachable';
  if (s && CLOSED.has(s)) return 'closed';
  return null;
}
