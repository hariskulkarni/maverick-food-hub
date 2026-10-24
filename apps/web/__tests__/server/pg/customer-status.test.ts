import { describe, it, expect } from 'vitest';
import { customerPaymentView, CUSTOMER_MESSAGES } from '@/server/pg/customer-status';

const now = new Date('2026-10-24T10:00:00Z');
const future = new Date('2026-10-24T10:10:00Z');
const past = new Date('2026-10-24T09:50:00Z');
const view = (attempts: { state: any; expiresAt: Date | null }[], orderStatus: any = 'PAYMENT_PENDING', legacy: any = null) =>
  customerPaymentView({ orderStatus, attempts, legacyPaymentStatus: legacy, now });

describe('customerPaymentView', () => {
  it.each([
    ['AWAITING_PAYMENT', future, 'AWAITING_PAYMENT', 'PENDING'],
    ['OBSERVED', null, 'CONFIRMING', 'PENDING'],
    ['BANK_VERIFIED', null, 'CONFIRMING', 'PENDING'],
    ['REVIEW_REQUIRED', null, 'VERIFYING', 'PENDING'],
    ['CREATE_UNKNOWN', null, 'STARTING', 'PENDING'],
    ['CREATED', null, 'STARTING', 'PENDING'],
    ['CAPTURED', null, 'CONFIRMED', 'COMPLETED'],
    ['FAILED', null, 'NOT_CONFIRMED', 'FAILED'],
    ['EXPIRED', null, 'NOT_CONFIRMED', 'FAILED'],
    ['AWAITING_PAYMENT', past, 'NOT_CONFIRMED', 'FAILED'],
  ])('%s (expires %s) -> phase %s / state %s', (s, exp, phase, state) => {
    const v = view([{ state: s, expiresAt: exp as Date | null }]);
    expect(v.phase).toBe(phase);
    expect(v.state).toBe(state);
    expect(v.message).toBe(CUSTOMER_MESSAGES[phase as keyof typeof CUSTOMER_MESSAGES]);
  });

  it('customer copy: observed = waiting for bank, review = do not pay again, failed = reconciled + UTR', () => {
    expect(CUSTOMER_MESSAGES.CONFIRMING).toMatch(/waiting for bank confirmation/i);
    expect(CUSTOMER_MESSAGES.VERIFYING).toMatch(/do not pay again/i);
    expect(CUSTOMER_MESSAGES.NOT_CONFIRMED).toMatch(/reconciled/i);
    expect(CUSTOMER_MESSAGES.NOT_CONFIRMED).toMatch(/UTR/);
  });

  it('a failed/expired attempt with an allocated bank credit shows LATE_RECEIVED and no retry (H-06)', () => {
    for (const state of ['FAILED', 'EXPIRED'] as const) {
      const v = view([{ state, expiresAt: null, allocated: true } as any], 'PAYMENT_FAILED');
      expect(v).toMatchObject({ phase: 'LATE_RECEIVED', state: 'PENDING', canRetry: false });
      expect(v.message).toMatch(/received after/i);
    }
  });

  it('never tells a customer they were not charged', () => {
    for (const m of Object.values(CUSTOMER_MESSAGES)) {
      expect(m).not.toMatch(/not (been )?(charged|debited)|no money|refunded automatically/i);
    }
  });

  it('retry only when every attempt is terminal-failed and the order is still payable', () => {
    expect(view([{ state: 'FAILED', expiresAt: null }]).canRetry).toBe(true);
    expect(view([{ state: 'EXPIRED', expiresAt: null }], 'PAYMENT_FAILED').canRetry).toBe(true);
    expect(view([{ state: 'FAILED', expiresAt: null }], 'CANCELLED_BY_CUSTOMER').canRetry).toBe(false);
  });

  it.each([
    ['CREATE_UNKNOWN', null],
    ['AWAITING_PAYMENT', future],
    ['OBSERVED', null],
    ['REVIEW_REQUIRED', null],
    ['CAPTURED', null],
  ])('an older/newer %s attempt blocks retry even if another attempt failed', (s, exp) => {
    const v = view([
      { state: 'FAILED', expiresAt: null },
      { state: s, expiresAt: exp as Date | null },
    ]);
    expect(v.canRetry).toBe(false);
    expect(v.phase).not.toBe('NOT_CONFIRMED');
  });

  it('expired AWAITING_PAYMENT does not block a retry', () => {
    expect(view([{ state: 'AWAITING_PAYMENT', expiresAt: past }]).canRetry).toBe(true);
  });

  it('legacy payment without attempts: derived from Payment.status, never retryable', () => {
    expect(view([], 'PAYMENT_PENDING', 'CAPTURED')).toMatchObject({ phase: 'CONFIRMED', canRetry: false });
    expect(view([], 'PAYMENT_PENDING', 'FAILED')).toMatchObject({ phase: 'NOT_CONFIRMED', state: 'FAILED', canRetry: false });
    expect(view([], 'PAYMENT_PENDING', 'PENDING')).toMatchObject({ phase: 'AWAITING_PAYMENT', canRetry: false });
    expect(view([], 'PAYMENT_PENDING', null)).toMatchObject({ phase: 'NONE', state: 'NONE', canRetry: false });
  });
});
