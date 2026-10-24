/**
 * Customer-safe view of a Flavrly PG payment, derived from PgPaymentAttempt.state.
 *
 * Rules: never expose UTR/VPA/review reasons; never say "you were not charged";
 * offer a retry only when no attempt for the order could still turn into money.
 */
import type { OrderStatus, PaymentStatus, PgAttemptState } from '@prisma/client';

export type CustomerPaymentPhase =
  | 'NONE'
  | 'STARTING'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMING'
  | 'VERIFYING'
  | 'CONFIRMED'
  | 'LATE_RECEIVED'
  | 'NOT_CONFIRMED';

/** Coarse state kept for the existing status page contract. */
export type CustomerPaymentState = 'NONE' | 'PENDING' | 'COMPLETED' | 'FAILED';

export interface CustomerPaymentView {
  state: CustomerPaymentState;
  phase: CustomerPaymentPhase;
  message: string;
  canRetry: boolean;
}

export const CUSTOMER_MESSAGES: Record<CustomerPaymentPhase, string> = {
  NONE: 'No payment has been started for this order yet.',
  STARTING: 'We are setting up your payment. Please do not pay again while this is in progress.',
  AWAITING_PAYMENT: 'Waiting for your UPI payment. Complete it in your UPI app.',
  CONFIRMING: 'Payment seen, waiting for bank confirmation. Please do not pay again.',
  VERIFYING: 'We are verifying your payment. Please do not pay again.',
  CONFIRMED: 'Payment confirmed.',
  LATE_RECEIVED:
    'Your payment was received after the payment window closed. We are reviewing it and will confirm your order or refund you. Please do not pay again.',
  NOT_CONFIRMED:
    'Payment not confirmed. If your bank debited you, it will be reconciled — contact support with your UPI reference (UTR).',
};

const PAID: ReadonlySet<PgAttemptState> = new Set(['CAPTURED', 'REFUND_PENDING', 'REFUNDED'] as PgAttemptState[]);

// Higher rank wins when an order has several attempts.
// NOT_CONFIRMED ranks lowest, so it is shown only when NO attempt is paid or unresolved
// (CREATED/CREATE_UNKNOWN, unexpired AWAITING_PAYMENT, OBSERVED/BANK_VERIFIED, REVIEW_REQUIRED).
function rank(state: PgAttemptState, expired: boolean, allocated: boolean): { rank: number; phase: CustomerPaymentPhase } {
  if (PAID.has(state)) return { rank: 6, phase: 'CONFIRMED' };
  // A bank credit allocated to a non-paid attempt (LATE_PAYMENT / OVERCOLLECTION): money arrived (H-06).
  if (allocated) return { rank: 5, phase: 'LATE_RECEIVED' };
  switch (state) {
    case 'REVIEW_REQUIRED':
      return { rank: 5, phase: 'VERIFYING' };
    case 'OBSERVED':
    case 'BANK_VERIFIED':
      return { rank: 4, phase: 'CONFIRMING' };
    case 'AWAITING_PAYMENT':
      return expired ? { rank: 1, phase: 'NOT_CONFIRMED' } : { rank: 3, phase: 'AWAITING_PAYMENT' };
    case 'CREATED':
    case 'CREATE_UNKNOWN':
      return { rank: 2, phase: 'STARTING' };
    default: // FAILED, EXPIRED, CANCELLED
      return { rank: 1, phase: 'NOT_CONFIRMED' };
  }
}

const PAYABLE_ORDER: ReadonlySet<string> = new Set(['PAYMENT_PENDING', 'PAYMENT_FAILED']);

function toState(phase: CustomerPaymentPhase): CustomerPaymentState {
  if (phase === 'CONFIRMED') return 'COMPLETED';
  if (phase === 'NOT_CONFIRMED') return 'FAILED';
  if (phase === 'NONE') return 'NONE';
  return 'PENDING';
}

export function customerPaymentView(input: {
  orderStatus: OrderStatus;
  attempts: { state: PgAttemptState; expiresAt: Date | null; allocated?: boolean }[];
  /** Latest youpi Payment.status, used only for pre-attempt (legacy) payments. */
  legacyPaymentStatus?: PaymentStatus | null;
  now?: Date;
}): CustomerPaymentView {
  const now = (input.now ?? new Date()).getTime();

  if (input.attempts.length === 0) {
    const s = input.legacyPaymentStatus;
    const phase: CustomerPaymentPhase = !s
      ? 'NONE'
      : s === 'CAPTURED' || s === 'REFUNDED'
        ? 'CONFIRMED'
        : s === 'FAILED'
          ? 'NOT_CONFIRMED'
          : 'AWAITING_PAYMENT';
    // Legacy rows carry no attempt state, so we cannot prove nothing is in flight: no retry.
    return { state: toState(phase), phase, message: CUSTOMER_MESSAGES[phase], canRetry: false };
  }

  let best = { rank: 0, phase: 'NONE' as CustomerPaymentPhase };
  for (const a of input.attempts) {
    const r = rank(a.state, a.expiresAt !== null && a.expiresAt.getTime() <= now, a.allocated === true);
    if (r.rank > best.rank) best = r;
  }
  const phase = best.phase;
  const canRetry = phase === 'NOT_CONFIRMED' && PAYABLE_ORDER.has(input.orderStatus);
  return { state: toState(phase), phase, message: CUSTOMER_MESSAGES[phase], canRetry };
}
