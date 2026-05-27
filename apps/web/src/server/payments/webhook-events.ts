/**
 * Pure mappers from Razorpay webhook events → our internal statuses.
 *
 * Kept dependency-free (no prisma/network) so the event→status logic is unit
 * testable in isolation. The webhook route handles the I/O (lookup + persist).
 *
 * Razorpay refund lifecycle events:
 *   refund.created   — refund accepted by Razorpay (money not yet returned)
 *   refund.processed — refund settled to the customer's source
 *   refund.failed    — refund could not be completed
 * The refund entity also carries its own `status` ('pending' | 'processed' |
 * 'failed'), which we prefer when present.
 */

export type RefundStatusLiteral = 'PENDING' | 'COMPLETED' | 'FAILED';
export type PaymentStatusLiteral = 'CAPTURED' | 'FAILED' | 'REFUNDED';

/** Map a Razorpay refund webhook to our RefundStatus, or null if not a refund event. */
export function refundStatusFromEvent(eventType: string, refundEntityStatus?: string): RefundStatusLiteral | null {
  const t = (eventType || '').toLowerCase();
  if (!t.startsWith('refund.')) return null;

  // The entity status is authoritative when present.
  const s = (refundEntityStatus || '').toLowerCase();
  if (s === 'processed') return 'COMPLETED';
  if (s === 'failed') return 'FAILED';
  if (s === 'pending' || s === 'created') return 'PENDING';

  // Fall back to the event name.
  if (t === 'refund.processed') return 'COMPLETED';
  if (t === 'refund.failed') return 'FAILED';
  if (t === 'refund.created' || t === 'refund.speed_changed') return 'PENDING';
  return 'PENDING';
}

/** Map a Razorpay payment webhook to our PaymentStatus, or null if not handled. */
export function paymentStatusFromEvent(eventType: string, paymentEntityStatus?: string): PaymentStatusLiteral | null {
  const t = (eventType || '').toLowerCase();
  const s = (paymentEntityStatus || '').toLowerCase();
  if (t === 'payment.captured' || t === 'order.paid' || s === 'captured') return 'CAPTURED';
  if (t === 'payment.failed' || s === 'failed') return 'FAILED';
  return null;
}
