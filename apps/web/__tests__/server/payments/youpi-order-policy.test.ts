import { describe, expect, it } from 'vitest';
import { isDirectUpiPrepayment } from '@/server/payments/youpi-order-policy';

describe('Flavrly PG order placement policy', () => {
  it.each(['PHONEPE', 'RAZORPAY'])('keeps %s Flavrly PG opt-in orders pending', (method) => {
    expect(isDirectUpiPrepayment(method, 'youpi')).toBe(true);
  });

  it.each(['PHONEPE', 'RAZORPAY', 'COD', 'WALLET'])('does not change legacy %s order behavior', (method) => {
    expect(isDirectUpiPrepayment(method)).toBe(false);
  });

  it('cannot turn COD or wallet into an online direct-UPI checkout', () => {
    expect(isDirectUpiPrepayment('COD', 'youpi')).toBe(false);
    expect(isDirectUpiPrepayment('WALLET', 'youpi')).toBe(false);
  });
});
