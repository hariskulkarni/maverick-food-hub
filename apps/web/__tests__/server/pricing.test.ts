import { describe, it, expect } from 'vitest';
import { pricing } from '@/server/pricing';

const base = {
  taxRatePct: 5,
  baseDeliveryFee: 40,
  perKmDeliveryFee: 8,
  branch: { lat: 12.97, lng: 77.64 },
  delivery: { lat: 12.97, lng: 77.64 }
};

describe('pricing — subtotal', () => {
  it('sums unitPrice * quantity across lines', () => {
    const r = pricing({
      ...base,
      lines: [
        { unitPrice: 120, quantity: 2 },
        { unitPrice: 50, quantity: 3 }
      ]
    });
    expect(r.subtotal).toBe(390);
  });
});

describe('pricing — coupons', () => {
  it('applies a flat-off coupon', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 500, quantity: 1 }],
      coupon: { flatOff: 75 }
    });
    expect(r.discountAmount).toBe(75);
    expect(r.couponApplied).toBe(true);
  });

  it('caps a percent coupon at maxDiscount', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 1000, quantity: 1 }],
      coupon: { percentOff: 50, maxDiscount: 200 }
    });
    // 50% of 1000 = 500, capped to 200
    expect(r.discountAmount).toBe(200);
  });

  it('honors minOrderAmount on a coupon', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 100, quantity: 1 }],
      coupon: { flatOff: 50, minOrderAmount: 250 }
    });
    expect(r.discountAmount).toBe(0);
    expect(r.couponApplied).toBe(false);
  });
});

describe('pricing — delivery fee', () => {
  it('returns the base delivery fee when branch == delivery (distance ~0)', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 100, quantity: 1 }]
    });
    expect(r.distanceKm).toBe(0);
    expect(r.deliveryFee).toBe(40);
  });

  it('adds per-km charges beyond the first free km', () => {
    const r = pricing({
      ...base,
      delivery: { lat: 13.0151, lng: 77.64 }, // ~5 km north of branch
      lines: [{ unitPrice: 100, quantity: 1 }]
    });
    expect(r.distanceKm).toBeGreaterThan(4.9);
    expect(r.distanceKm).toBeLessThan(5.1);
    // ~ 40 + 8 * (5 - 1) ≈ 72; allow tolerance for haversine rounding.
    expect(r.deliveryFee).toBeGreaterThanOrEqual(70);
    expect(r.deliveryFee).toBeLessThanOrEqual(74);
  });

  it('treats missing delivery as pickup — no distance component', () => {
    const r = pricing({
      ...base,
      delivery: null,
      lines: [{ unitPrice: 200, quantity: 1 }]
    });
    expect(r.distanceKm).toBe(0);
    // Implementation always adds baseDeliveryFee regardless of pickup; we record
    // current behavior so any future "free pickup" change is caught here.
    expect(r.deliveryFee).toBe(40);
  });

  it('does NOT auto-apply free delivery at a subtotal threshold (documents current behavior)', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 5000, quantity: 1 }]
    });
    // No free-delivery threshold in pricing.ts — fee is unchanged regardless of subtotal.
    expect(r.deliveryFee).toBe(40);
  });
});

describe('pricing — wallet / total clamping', () => {
  it('never returns a negative total when wallet exceeds the subtotal', () => {
    const r = pricing({
      ...base,
      lines: [{ unitPrice: 50, quantity: 1 }],
      walletApplied: 9999
    });
    expect(r.total).toBe(0);
  });
});

describe('pricing — tax rounding', () => {
  it('rounds tax to two decimals', () => {
    const r = pricing({
      ...base,
      taxRatePct: 5,
      lines: [{ unitPrice: 33.33, quantity: 1 }]
    });
    // 5% of 33.33 = 1.6665 → clampTwo → 1.67
    expect(r.taxAmount).toBe(1.67);
  });
});
