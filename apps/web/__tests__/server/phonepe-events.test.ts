/**
 * PhonePe pure helpers — webhook authentication, event normalisation, status
 * mapping, idempotency keys, error copy and the refund window.
 *
 * These are the security- and money-critical decisions, and none of them touch
 * the network or the database, so they get exhaustive coverage here.
 */
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalEventName,
  expectedWebhookAuth,
  isWithinRefundWindow,
  normalizePhonePeEvent,
  paymentStatusFromPhonePe,
  phonePeErrorMessage,
  phonePeEventId,
  refundStatusFromPhonePe,
  REFUND_WINDOW_DAYS,
  toPhonePeState,
  verifyWebhookAuth,
} from '@/server/payments/phonepe-events';

const USER = 'flavrly_hook';
const PASS = 's3cr3t-pass';
const GOOD = crypto.createHash('sha256').update(`${USER}:${PASS}`).digest('hex');

describe('webhook authentication', () => {
  it('computes SHA256(username:password) as lowercase hex', () => {
    expect(expectedWebhookAuth(USER, PASS)).toBe(GOOD);
    expect(expectedWebhookAuth(USER, PASS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the exact header PhonePe sends', () => {
    expect(verifyWebhookAuth(GOOD, USER, PASS)).toBe(true);
  });

  it('accepts scheme prefixes, whitespace and upper-case hex', () => {
    expect(verifyWebhookAuth(`SHA256 ${GOOD}`, USER, PASS)).toBe(true);
    expect(verifyWebhookAuth(`SHA256=${GOOD}`, USER, PASS)).toBe(true);
    expect(verifyWebhookAuth(`  ${GOOD}  `, USER, PASS)).toBe(true);
    expect(verifyWebhookAuth(GOOD.toUpperCase(), USER, PASS)).toBe(true);
  });

  it('rejects a wrong password, wrong username, or tampered digest', () => {
    expect(verifyWebhookAuth(GOOD, USER, 'wrong')).toBe(false);
    expect(verifyWebhookAuth(GOOD, 'wrong', PASS)).toBe(false);
    const flipped = GOOD.slice(0, 63) + (GOOD.endsWith('a') ? 'b' : 'a');
    expect(verifyWebhookAuth(flipped, USER, PASS)).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    expect(verifyWebhookAuth(null, USER, PASS)).toBe(false);
    expect(verifyWebhookAuth(undefined, USER, PASS)).toBe(false);
    expect(verifyWebhookAuth('', USER, PASS)).toBe(false);
    expect(verifyWebhookAuth('not-hex', USER, PASS)).toBe(false);
    expect(verifyWebhookAuth(GOOD.slice(0, 40), USER, PASS)).toBe(false); // short
    expect(verifyWebhookAuth(GOOD + 'ab', USER, PASS)).toBe(false); // long
    expect(verifyWebhookAuth(GOOD, '', PASS)).toBe(false);
    expect(verifyWebhookAuth(GOOD, USER, '')).toBe(false);
  });

  it('does not confuse "a:bc" with "ab:c"', () => {
    // A naive concat would collide these; the colon separator must be real.
    expect(expectedWebhookAuth('a', 'bc')).not.toBe(expectedWebhookAuth('ab', 'c'));
  });
});

describe('canonicalEventName', () => {
  it('normalises dotted REST names and SDK enum names to one spelling', () => {
    expect(canonicalEventName('checkout.order.completed')).toBe('CHECKOUT_ORDER_COMPLETED');
    expect(canonicalEventName('CHECKOUT_ORDER_COMPLETED')).toBe('CHECKOUT_ORDER_COMPLETED');
    expect(canonicalEventName('pg.refund.completed')).toBe('PG_REFUND_COMPLETED');
    expect(canonicalEventName('  pg.refund.failed ')).toBe('PG_REFUND_FAILED');
  });
  it('returns UNKNOWN for junk', () => {
    expect(canonicalEventName(undefined)).toBe('UNKNOWN');
    expect(canonicalEventName(42)).toBe('UNKNOWN');
    expect(canonicalEventName('')).toBe('UNKNOWN');
  });
});

describe('toPhonePeState', () => {
  it('maps the documented states', () => {
    expect(toPhonePeState('COMPLETED')).toBe('COMPLETED');
    expect(toPhonePeState('failed')).toBe('FAILED');
    expect(toPhonePeState('Pending')).toBe('PENDING');
  });
  it('maps the refund-only CONFIRMED state to PENDING — accepted, not settled', () => {
    // PhonePe's refund lifecycle is PENDING -> CONFIRMED -> COMPLETED/FAILED.
    // Treating CONFIRMED as terminal would mark an order REFUNDED before the
    // customer had actually been paid back.
    expect(toPhonePeState('CONFIRMED')).toBe('PENDING');
    expect(refundStatusFromPhonePe(toPhonePeState('CONFIRMED'))).toBe('PENDING');
  });

  it('returns null rather than guessing on anything else', () => {
    expect(toPhonePeState('WEIRD')).toBeNull();
    expect(toPhonePeState(undefined)).toBeNull();
    expect(toPhonePeState(null)).toBeNull();
    expect(toPhonePeState(7)).toBeNull();
  });
});

describe('normalizePhonePeEvent', () => {
  it('parses the documented order-completed webhook', () => {
    const e = normalizePhonePeEvent({
      event: 'checkout.order.completed',
      payload: {
        orderId: 'OMO2403282020198641071317',
        merchantId: 'M123',
        merchantOrderId: 'ckorder1-1',
        state: 'COMPLETED',
        amount: 10000,
        expireAt: 1724866793837,
        paymentDetails: [
          { paymentMode: 'UPI_QR', transactionId: 'OM12334', timestamp: 1724866793837, amount: 10000, state: 'COMPLETED' },
        ],
      },
    });
    expect(e.event).toBe('CHECKOUT_ORDER_COMPLETED');
    expect(e.kind).toBe('ORDER');
    expect(e.state).toBe('COMPLETED');
    expect(e.merchantOrderId).toBe('ckorder1-1');
    expect(e.orderId).toBe('OMO2403282020198641071317');
    expect(e.transactionId).toBe('OM12334');
    expect(e.paymentMode).toBe('UPI_QR');
    expect(e.amount).toBe(10000);
  });

  it('parses the documented order-failed webhook and surfaces error codes', () => {
    const e = normalizePhonePeEvent({
      event: 'checkout.order.failed',
      payload: {
        orderId: 'OMO2403282020198641071311',
        merchantOrderId: 'ckorder2-1',
        state: 'FAILED',
        amount: 10000,
        paymentDetails: [
          { paymentMode: 'UPI_COLLECT', state: 'FAILED', errorCode: 'AUTHORIZATION_ERROR', detailedErrorCode: 'ZM' },
        ],
      },
    });
    expect(e.kind).toBe('ORDER');
    expect(e.state).toBe('FAILED');
    expect(e.errorCode).toBe('AUTHORIZATION_ERROR');
    expect(e.detailedErrorCode).toBe('ZM');
  });

  it('parses the SDK-style { type } spelling', () => {
    const e = normalizePhonePeEvent({ type: 'PG_ORDER_COMPLETED', payload: { merchantOrderId: 'x-1', state: 'COMPLETED' } });
    expect(e.event).toBe('PG_ORDER_COMPLETED');
    expect(e.kind).toBe('ORDER');
    expect(e.state).toBe('COMPLETED');
  });

  it('parses a flattened refund callback with no payload wrapper', () => {
    const e = normalizePhonePeEvent({
      originalMerchantOrderId: 'Order123',
      merchantRefundId: 'rfnd-abc',
      amount: 100,
      state: 'COMPLETED',
      refundId: 'OMR7878098045517540996',
      timestamp: 1730869961754,
      splitInstruments: [{ amount: 100, rail: { type: 'UPI', utr: '586756785' } }],
    });
    expect(e.kind).toBe('REFUND');
    expect(e.merchantRefundId).toBe('rfnd-abc');
    expect(e.merchantOrderId).toBe('Order123');
    expect(e.refundId).toBe('OMR7878098045517540996');
    expect(e.state).toBe('COMPLETED');
  });

  it('classifies refund events by name even when ids are missing', () => {
    expect(normalizePhonePeEvent({ event: 'pg.refund.failed', payload: {} }).kind).toBe('REFUND');
    expect(normalizePhonePeEvent({ type: 'PG_REFUND_ACCEPTED', payload: {} }).kind).toBe('REFUND');
  });

  it('picks the payment attempt matching the root state, not just the last one', () => {
    const e = normalizePhonePeEvent({
      event: 'checkout.order.completed',
      payload: {
        merchantOrderId: 'o-1',
        state: 'COMPLETED',
        paymentDetails: [
          { transactionId: 'T1', state: 'COMPLETED', paymentMode: 'UPI_INTENT' },
          { transactionId: 'T2', state: 'FAILED', paymentMode: 'CARD' },
        ],
      },
    });
    expect(e.transactionId).toBe('T1');
    expect(e.paymentMode).toBe('UPI_INTENT');
  });

  it('never throws on hostile or empty input', () => {
    for (const input of [null, undefined, 'string', 42, [], {}, { payload: null }, { payload: 'nope' }]) {
      expect(() => normalizePhonePeEvent(input)).not.toThrow();
    }
    const e = normalizePhonePeEvent(null);
    expect(e.kind).toBe('UNKNOWN');
    expect(e.state).toBeNull();
    expect(e.merchantOrderId).toBeNull();
  });
});

describe('status mapping', () => {
  it('maps order state to payment status, trusting state over the event name', () => {
    expect(paymentStatusFromPhonePe('COMPLETED')).toBe('CAPTURED');
    expect(paymentStatusFromPhonePe('FAILED')).toBe('FAILED');
    expect(paymentStatusFromPhonePe('PENDING')).toBe('PENDING');
    // A "completed" event carrying a FAILED state must map to FAILED.
    expect(paymentStatusFromPhonePe('FAILED', 'checkout.order.completed')).toBe('FAILED');
  });

  it('falls back to the event name only when state is unusable', () => {
    expect(paymentStatusFromPhonePe(null, 'checkout.order.completed')).toBe('CAPTURED');
    expect(paymentStatusFromPhonePe(null, 'checkout.order.failed')).toBe('FAILED');
    expect(paymentStatusFromPhonePe(null, 'something.else')).toBeNull();
    expect(paymentStatusFromPhonePe(null)).toBeNull();
  });

  it('maps refund states, treating PG_REFUND_ACCEPTED as not-yet-settled', () => {
    expect(refundStatusFromPhonePe('COMPLETED')).toBe('COMPLETED');
    expect(refundStatusFromPhonePe('FAILED')).toBe('FAILED');
    expect(refundStatusFromPhonePe('PENDING')).toBe('PENDING');
    // Accepted ≠ settled: money has not moved yet.
    expect(refundStatusFromPhonePe('COMPLETED', 'pg.refund.accepted')).toBe('PENDING');
    expect(refundStatusFromPhonePe(null, 'pg.refund.completed')).toBe('COMPLETED');
    expect(refundStatusFromPhonePe(null, 'pg.refund.failed')).toBe('FAILED');
  });
});

describe('phonePeEventId', () => {
  const base = normalizePhonePeEvent({
    event: 'checkout.order.completed',
    payload: { merchantOrderId: 'o-1', state: 'COMPLETED' },
  });
  const body = JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: 'o-1', state: 'COMPLETED' } });

  it('is stable for an identical redelivery', () => {
    expect(phonePeEventId(base, body)).toBe(phonePeEventId(base, body));
  });

  it('differs across a genuine state progression', () => {
    const pendingBody = JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: 'o-1', state: 'PENDING' } });
    const pending = normalizePhonePeEvent(JSON.parse(pendingBody));
    expect(phonePeEventId(pending, pendingBody)).not.toBe(phonePeEventId(base, body));
  });

  it('differs across orders and across differing bodies with equal ids', () => {
    const otherBody = JSON.stringify({ event: 'checkout.order.completed', payload: { merchantOrderId: 'o-2', state: 'COMPLETED' } });
    expect(phonePeEventId(normalizePhonePeEvent(JSON.parse(otherBody)), otherBody)).not.toBe(phonePeEventId(base, body));

    const sameIdsDifferentContent = JSON.stringify({
      event: 'checkout.order.completed',
      payload: { merchantOrderId: 'o-1', state: 'COMPLETED', amount: 999 },
    });
    expect(phonePeEventId(normalizePhonePeEvent(JSON.parse(sameIdsDifferentContent)), sameIdsDifferentContent)).not.toBe(
      phonePeEventId(base, body),
    );
  });

  it('is prefixed so PaymentWebhookEvent rows are attributable and never collide with Razorpay ids', () => {
    expect(phonePeEventId(base, body).startsWith('phonepe:')).toBe(true);
  });
});

describe('phonePeErrorMessage', () => {
  it('prefers the detailed code and returns customer-safe copy', () => {
    expect(phonePeErrorMessage('AUTHORIZATION_ERROR', 'ZM')).toBe('Incorrect UPI PIN. Please try again.');
    expect(phonePeErrorMessage(undefined, 'Z9')).toMatch(/insufficient balance/i);
    expect(phonePeErrorMessage('ORDER_CANCELLED_BY_USER')).toMatch(/cancelled/i);
  });

  it('never leaks a raw bank code as the whole message, but keeps it for support', () => {
    const msg = phonePeErrorMessage('SOMETHING', 'QQ99');
    expect(msg).toContain('QQ99');
    expect(msg).toMatch(/^Payment failed/);
  });

  it('has a neutral default', () => {
    expect(phonePeErrorMessage()).toBe('Payment failed.');
    expect(phonePeErrorMessage(null, null)).toBe('Payment failed.');
  });

  it('is case-insensitive on codes', () => {
    expect(phonePeErrorMessage(undefined, 'zm')).toBe(phonePeErrorMessage(undefined, 'ZM'));
  });
});

describe('refund window', () => {
  const now = new Date('2026-08-01T00:00:00Z');
  it('accepts a payment inside PhonePe’s 3-month cap', () => {
    expect(isWithinRefundWindow(new Date('2026-07-31T00:00:00Z'), now)).toBe(true);
    expect(isWithinRefundWindow(new Date(now.getTime() - (REFUND_WINDOW_DAYS - 1) * 86400_000), now)).toBe(true);
  });
  it('rejects a payment past it', () => {
    expect(isWithinRefundWindow(new Date(now.getTime() - (REFUND_WINDOW_DAYS + 1) * 86400_000), now)).toBe(false);
  });
  it('rejects a future capture date (clock skew / bad data)', () => {
    expect(isWithinRefundWindow(new Date(now.getTime() + 86400_000), now)).toBe(false);
  });
});
