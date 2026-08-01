/**
 * PhonePe — pure, dependency-free helpers.
 *
 * Everything in this module is synchronous and side-effect free (no prisma, no
 * network, no env reads) so the security-critical bits — webhook authentication
 * and event→status mapping — are unit-testable in isolation. The route handlers
 * own the I/O.
 *
 * Reference:
 *   https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook
 *   https://developer.phonepe.com/payment-gateway/backend-sdk/nodejs-be-sdk/api-reference-node-js/webhook-handling
 *
 * Two notes that drive the shape of this file:
 *
 *  1. PhonePe authenticates webhooks with a *static* credential, not an HMAC of
 *     the body: the Authorization header carries `SHA256(username:password)`.
 *     That means the header is replayable, so authentication alone is not
 *     integrity — every state change is still re-confirmed against the Order
 *     Status API before we move money (see `phonepe-webhook` route).
 *
 *  2. The wire format is not stable across PhonePe's own docs: the REST webhook
 *     docs use `{ event: "checkout.order.completed" }` while the backend SDKs
 *     emit `{ type: "CHECKOUT_ORDER_COMPLETED" }`, and refund callbacks have
 *     been observed both wrapped in `payload` and flattened at the root. We
 *     normalise all of those into one shape rather than trusting one spelling.
 */

import crypto from 'node:crypto';

// ─── Authentication ─────────────────────────────────────────────────────────

/** The Authorization header value PhonePe sends: lowercase hex SHA256("user:pass"). */
export function expectedWebhookAuth(username: string, password: string): string {
  return crypto.createHash('sha256').update(`${username}:${password}`).digest('hex');
}

/**
 * Constant-time check of an inbound webhook Authorization header.
 *
 * Tolerates the variations seen in the wild: a `SHA256 ` / `SHA256=` scheme
 * prefix, surrounding whitespace, and upper-case hex. Returns false (never
 * throws) for anything malformed — a missing header must not 500 the route.
 */
export function verifyWebhookAuth(
  header: string | null | undefined,
  username: string | null | undefined,
  password: string | null | undefined,
): boolean {
  if (!header || !username || !password) return false;
  const presented = header.trim().replace(/^sha256[\s=]+/i, '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(presented)) return false;
  const expected = expectedWebhookAuth(username, password);
  try {
    return crypto.timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ─── Event normalisation ────────────────────────────────────────────────────

export type PhonePeState = 'PENDING' | 'COMPLETED' | 'FAILED';
export type PhonePeEventKind = 'ORDER' | 'REFUND' | 'UNKNOWN';

export interface NormalizedPhonePeEvent {
  /** Canonical upper-snake event name, e.g. CHECKOUT_ORDER_COMPLETED. */
  event: string;
  /** Whether this event concerns an order (payment) or a refund. */
  kind: PhonePeEventKind;
  /** Root-level state — the field PhonePe tells you to trust. */
  state: PhonePeState | null;
  /** Our merchant order id (what we sent as merchantOrderId). */
  merchantOrderId: string | null;
  /** Our merchant refund id (what we sent as merchantRefundId). */
  merchantRefundId: string | null;
  /** PhonePe's own ids. */
  orderId: string | null;
  refundId: string | null;
  transactionId: string | null;
  /** Amount in paisa, as sent. */
  amount: number | null;
  errorCode: string | null;
  detailedErrorCode: string | null;
  paymentMode: string | null;
  /** The unwrapped payload object we read everything from. */
  payload: Record<string, unknown>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `checkout.order.completed` / `CHECKOUT_ORDER_COMPLETED` → `CHECKOUT_ORDER_COMPLETED`. */
export function canonicalEventName(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return 'UNKNOWN';
  return raw.trim().replace(/[.\-\s]+/g, '_').toUpperCase();
}

/**
 * COMPLETED | FAILED | PENDING, else null. Anything unknown is deliberately
 * null so an unrecognised state can never be mistaken for success.
 *
 * `CONFIRMED` is refund-only: PhonePe's refund lifecycle is
 * PENDING → CONFIRMED → COMPLETED/FAILED, where CONFIRMED means accepted but
 * not yet settled to the customer. It maps to PENDING because money has not
 * moved — treating it as terminal would mark an order REFUNDED before the
 * customer saw a paisa. Orders never return CONFIRMED.
 */
export function toPhonePeState(raw: unknown): PhonePeState | null {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (s === 'COMPLETED' || s === 'SUCCESS') return 'COMPLETED';
  if (s === 'FAILED' || s === 'ERROR') return 'FAILED';
  if (s === 'PENDING' || s === 'CONFIRMED') return 'PENDING';
  return null;
}

function kindOf(event: string, payload: Record<string, unknown>): PhonePeEventKind {
  if (event.includes('REFUND')) return 'REFUND';
  if (event.includes('ORDER') || event.includes('CHECKOUT') || event.includes('PAYMENT')) return 'ORDER';
  // Fall back to payload shape when the event name is unrecognised.
  if (payload.merchantRefundId || payload.refundId || payload.originalMerchantOrderId) return 'REFUND';
  if (payload.merchantOrderId || payload.orderId) return 'ORDER';
  return 'UNKNOWN';
}

/**
 * Turn any PhonePe webhook body into one predictable shape.
 *
 * Accepts `{ event, payload }`, `{ type, payload }`, and flattened bodies where
 * the payload fields sit at the root (observed on refund callbacks).
 */
export function normalizePhonePeEvent(body: unknown): NormalizedPhonePeEvent {
  const root = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const inner = (typeof root.payload === 'object' && root.payload !== null
    ? (root.payload as Record<string, unknown>)
    : root) as Record<string, unknown>;

  const event = canonicalEventName(root.event ?? root.type);
  const kind = kindOf(event, inner);

  // On refund callbacks `originalMerchantOrderId` is the order we charged.
  const merchantOrderId = str(inner.merchantOrderId) ?? str(inner.originalMerchantOrderId);

  const details = Array.isArray(inner.paymentDetails) ? (inner.paymentDetails as Record<string, unknown>[]) : [];
  // Prefer the attempt whose state matches the root state; else the last one.
  const rootState = toPhonePeState(inner.state);
  const attempt =
    details.find((d) => toPhonePeState(d?.state) === rootState) ?? details[details.length - 1] ?? {};

  return {
    event,
    kind,
    state: rootState,
    merchantOrderId,
    merchantRefundId: str(inner.merchantRefundId),
    orderId: str(inner.orderId),
    refundId: str(inner.refundId),
    transactionId: str(attempt.transactionId),
    amount: num(inner.amount),
    errorCode: str(inner.errorCode) ?? str(attempt.errorCode),
    detailedErrorCode: str(inner.detailedErrorCode) ?? str(attempt.detailedErrorCode),
    paymentMode: str(attempt.paymentMode),
    payload: inner,
  };
}

// ─── Status mapping ─────────────────────────────────────────────────────────

export type PaymentStatusLiteral = 'PENDING' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
export type RefundStatusLiteral = 'PENDING' | 'COMPLETED' | 'FAILED';

/**
 * Order state → our PaymentStatus.
 *
 * PhonePe's guidance is explicit: trust the root-level `state`, not the event
 * name. We therefore map from state and use the event only as a tiebreak when
 * state is missing or unrecognised.
 */
export function paymentStatusFromPhonePe(state: PhonePeState | null, event?: string): PaymentStatusLiteral | null {
  if (state === 'COMPLETED') return 'CAPTURED';
  if (state === 'FAILED') return 'FAILED';
  if (state === 'PENDING') return 'PENDING';
  const e = canonicalEventName(event);
  if (e.endsWith('_COMPLETED')) return 'CAPTURED';
  if (e.endsWith('_FAILED')) return 'FAILED';
  return null;
}

/** Refund state → our RefundStatus. `PG_REFUND_ACCEPTED` means accepted-not-settled. */
export function refundStatusFromPhonePe(state: PhonePeState | null, event?: string): RefundStatusLiteral | null {
  const e = canonicalEventName(event);
  if (e === 'PG_REFUND_ACCEPTED') return 'PENDING';
  if (state === 'COMPLETED') return 'COMPLETED';
  if (state === 'FAILED') return 'FAILED';
  if (state === 'PENDING') return 'PENDING';
  if (e.endsWith('_COMPLETED')) return 'COMPLETED';
  if (e.endsWith('_FAILED')) return 'FAILED';
  return null;
}

// ─── Idempotency key ────────────────────────────────────────────────────────

/**
 * PhonePe sends no event id, so we synthesise a stable one.
 *
 * Identical redeliveries collapse to the same key (PhonePe retries until it
 * gets a 2xx), while a genuine progression — PENDING → COMPLETED, or a second
 * refund on the same order — produces a different key and is processed. The
 * body digest is included so two events that agree on every id but differ in
 * content are not silently swallowed.
 */
export function phonePeEventId(e: NormalizedPhonePeEvent, rawBody: string): string {
  const subject = e.merchantRefundId ?? e.merchantOrderId ?? e.refundId ?? e.orderId ?? 'unknown';
  const digest = crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 16);
  return `phonepe:${e.event}:${subject}:${e.state ?? 'NA'}:${digest}`;
}

// ─── Error-code copy ────────────────────────────────────────────────────────

/**
 * Customer-facing text for PhonePe's detailed error codes.
 *
 * Source: https://developer.phonepe.com/payment-gateway/error-codes
 * Anything unmapped falls back to a neutral message — we never surface a raw
 * bank code to a customer.
 */
const ERROR_COPY: Record<string, string> = {
  Z9: 'Your bank reported insufficient balance.',
  IE: 'Your bank reported insufficient balance.',
  ZM: 'Incorrect UPI PIN. Please try again.',
  Z6: 'Too many incorrect PIN attempts. Try again later or use another method.',
  ZA: 'You cancelled the payment.',
  ORDER_CANCELLED_BY_USER: 'You cancelled the payment.',
  ZH: 'That UPI ID is not valid.',
  U90: 'Your bank is having a temporary technical issue. Please try again.',
  UT: 'Your bank is having a temporary technical issue. Please try again.',
  U28: 'Your bank is having a temporary technical issue. Please try again.',
  XB: 'Your bank is having a temporary technical issue. Please try again.',
  XY: 'Your bank is having a temporary technical issue. Please try again.',
  YE: 'Your bank account is blocked or frozen.',
  FP: 'Your bank account is frozen.',
  K1: 'Your bank declined the payment for security reasons.',
  XP: 'Your bank declined the payment for security reasons.',
  XV: 'Your bank declined the payment for security reasons.',
  Z7: 'This exceeds your bank’s payment limit.',
  Z8: 'This exceeds your bank’s payment limit.',
  U03: 'This exceeds your bank’s payment limit.',
  ZU: 'This exceeds your bank’s payment limit.',
  AUTHORIZATION_ERROR: 'The payment could not be authorised.',
  TIMED_OUT: 'The payment timed out before it completed.',
  INTERNAL_SECURITY_BLOCK_1: 'Payment blocked: this site is not the domain registered with PhonePe.',
  INTERNAL_SECURITY_BLOCK_2: 'Payment blocked: server IP does not match the registered details.',
  INTERNAL_SECURITY_BLOCK_6: 'Payment blocked: merchant video KYC is incomplete.',
  BF_034: 'Refund failed: insufficient balance in the settlement account.',
  REFUND_FOR_TXN_OLDER_THAN_LIMIT: 'Refund window has closed for this transaction.',
};

/** Human-readable reason for a failed PhonePe payment or refund. */
export function phonePeErrorMessage(errorCode?: string | null, detailedErrorCode?: string | null): string {
  const key = (detailedErrorCode || '').toUpperCase();
  if (key && ERROR_COPY[key]) return ERROR_COPY[key];
  const alt = (errorCode || '').toUpperCase();
  if (alt && ERROR_COPY[alt]) return ERROR_COPY[alt];
  if (alt || key) return `Payment failed (${detailedErrorCode || errorCode}).`;
  return 'Payment failed.';
}

/**
 * PhonePe's own hard cap: refunds must be raised within 3 months of the
 * original transaction. Enforced client-side so we fail fast with a clear
 * message instead of a BF_/REFUND_FOR_TXN_OLDER_THAN_LIMIT round-trip.
 */
export const REFUND_WINDOW_DAYS = 90;

export function isWithinRefundWindow(capturedAt: Date, now: Date = new Date()): boolean {
  const ms = now.getTime() - capturedAt.getTime();
  return ms >= 0 && ms <= REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}
