import { describe, it, expect } from 'vitest';
import { pricing } from '../../src/server/pricing';

describe('pricing', () => {
  const base = {
    taxRatePct: 5,
    baseDeliveryFee: 40,
    perKmDeliveryFee: 8,
    branch: { lat: 12.97, lng: 77.64 },
    delivery: { lat: 12.97, lng: 77.64 }
  };

  it('computes subtotal + tax + base delivery for a single line', () => {
    const r = pricing({ ...base, lines: [{ unitPrice: 100, quantity: 2 }] });
    expect(r.subtotal).toBe(200);
    expect(r.taxAmount).toBe(10); // 5% of 200
    expect(r.deliveryFee).toBe(40); // distance ~0
    expect(r.total).toBe(250);
  });

  it('applies a flat-off coupon over the min-order threshold', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 300, quantity: 1 }],
      coupon: { flatOff: 50, minOrderAmount: 250 }
    });
    expect(r.discountAmount).toBe(50);
    expect(r.couponApplied).toBe(true);
  });

  it('does not apply a coupon below min-order threshold', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 100, quantity: 1 }],
      coupon: { flatOff: 50, minOrderAmount: 250 }
    });
    expect(r.discountAmount).toBe(0);
    expect(r.couponApplied).toBe(false);
  });

  it('caps percent discount at maxDiscount', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 1000, quantity: 1 }],
      coupon: { percentOff: 50, maxDiscount: 200 }
    });
    expect(r.discountAmount).toBe(200);
  });

  it('subtracts wallet and loyalty from total', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 200, quantity: 1 }],
      walletApplied: 50,
      loyaltyApplied: 20
    });
    // subtotal 200 + tax 10 + delivery 40 - 50 - 20 = 180
    expect(r.total).toBe(180);
  });

  it('never returns a negative total', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 50, quantity: 1 }],
      walletApplied: 999
    });
    expect(r.total).toBe(0);
  });
});
