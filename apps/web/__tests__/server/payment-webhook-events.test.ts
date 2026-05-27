import { describe, it, expect } from 'vitest';
import { refundStatusFromEvent, paymentStatusFromEvent } from '@/server/payments/webhook-events';
import { PROVIDERS, PROVIDER_LIST } from '@/server/integrations/providers';

describe('refundStatusFromEvent', () => {
  it('returns null for non-refund events', () => {
    expect(refundStatusFromEvent('payment.captured')).toBeNull();
    expect(refundStatusFromEvent('order.paid')).toBeNull();
    expect(refundStatusFromEvent('')).toBeNull();
  });

  it('maps refund.processed → COMPLETED', () => {
    expect(refundStatusFromEvent('refund.processed')).toBe('COMPLETED');
  });

  it('maps refund.failed → FAILED', () => {
    expect(refundStatusFromEvent('refund.failed')).toBe('FAILED');
  });

  it('maps refund.created → PENDING', () => {
    expect(refundStatusFromEvent('refund.created')).toBe('PENDING');
  });

  it('prefers the refund entity status when present', () => {
    expect(refundStatusFromEvent('refund.created', 'processed')).toBe('COMPLETED');
    expect(refundStatusFromEvent('refund.created', 'failed')).toBe('FAILED');
    expect(refundStatusFromEvent('refund.processed', 'pending')).toBe('PENDING');
  });

  it('is case-insensitive on the event name', () => {
    expect(refundStatusFromEvent('REFUND.PROCESSED')).toBe('COMPLETED');
  });
});

describe('paymentStatusFromEvent', () => {
  it('maps capture/order.paid → CAPTURED', () => {
    expect(paymentStatusFromEvent('payment.captured')).toBe('CAPTURED');
    expect(paymentStatusFromEvent('order.paid')).toBe('CAPTURED');
    expect(paymentStatusFromEvent('payment.authorized', 'captured')).toBe('CAPTURED');
  });
  it('maps failures → FAILED', () => {
    expect(paymentStatusFromEvent('payment.failed')).toBe('FAILED');
    expect(paymentStatusFromEvent('payment.x', 'failed')).toBe('FAILED');
  });
  it('returns null for unrelated events', () => {
    expect(paymentStatusFromEvent('refund.created')).toBeNull();
  });
});

describe('integration provider registry — OTP (2Factor)', () => {
  it('registers TWOFACTOR with an apiKey secret field', () => {
    expect(PROVIDERS.TWOFACTOR).toBeTruthy();
    expect(PROVIDERS.TWOFACTOR.title.toLowerCase()).toContain('otp');
    const apiKey = PROVIDERS.TWOFACTOR.fields.find((f) => f.key === 'apiKey');
    expect(apiKey?.secret).toBe(true);
    expect(apiKey?.required).toBe(true);
  });

  it('lists 2Factor in the provider catalog (so it shows in the CMS/settings)', () => {
    expect(PROVIDER_LIST.some((p) => p.key === 'TWOFACTOR')).toBe(true);
  });

  it('Razorpay webhook secret field guides on URL + refund events', () => {
    const ws = PROVIDERS.RAZORPAY.fields.find((f) => f.key === 'webhookSecret');
    expect(ws?.secret).toBe(true);
    expect((ws?.hint ?? '').toLowerCase()).toContain('refund.processed');
    expect((ws?.hint ?? '')).toContain('/api/payments/razorpay/webhook');
  });
});
