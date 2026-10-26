import { describe, it, expect } from 'vitest';
import { apiErrorMessage, canPayNow, submitMethod } from '@/lib/checkout-helpers';

describe('submitMethod (P0-1)', () => {
  it('₹0 order is settled by WALLET, otherwise the chosen method', () => {
    expect(submitMethod('PHONEPE', 0)).toBe('WALLET');
    expect(submitMethod('COD', 0)).toBe('WALLET');
    expect(submitMethod('RAZORPAY', 120)).toBe('RAZORPAY');
    expect(submitMethod('COD', undefined)).toBe('COD');
  });
});

describe('apiErrorMessage (P2-17)', () => {
  it('never returns raw JSON', () => {
    expect(apiErrorMessage('{"error":"Failed to place order","detail":"Restaurant is closed. Closed — opens at 11"}')).toBe('Restaurant is closed. Closed — opens at 11');
    expect(apiErrorMessage('{"error":"Your wallet does not cover this order."}')).toBe('Your wallet does not cover this order.');
    expect(apiErrorMessage('{"formErrors":[],"fieldErrors":{"items":["bad"]}}')).toBe('Some order details are invalid. Please review your cart.');
    expect(apiErrorMessage('Unauthorized')).toBe('Unauthorized');
    expect(apiErrorMessage('<html>oops</html>')).toMatch(/Something went wrong/);
    expect(apiErrorMessage('')).toMatch(/Something went wrong/);
  });
});

describe('canPayNow (P0-4)', () => {
  it('only unpaid online orders', () => {
    expect(canPayNow({ status: 'PAYMENT_PENDING', paymentMethod: 'PHONEPE' })).toBe(true);
    expect(canPayNow({ status: 'PAYMENT_FAILED', paymentMethod: 'RAZORPAY' })).toBe(true);
    expect(canPayNow({ status: 'RECEIVED', paymentMethod: 'PHONEPE' })).toBe(false);
    expect(canPayNow({ status: 'PAYMENT_PENDING', paymentMethod: 'COD' })).toBe(false);
  });
});
