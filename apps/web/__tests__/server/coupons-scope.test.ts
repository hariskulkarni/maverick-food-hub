import { describe, it, expect } from 'vitest';
import { isLegacyCouponUsable, type LegacyCouponRow } from '@/server/coupons';

const now = new Date('2026-10-24T12:00:00Z');
const base: LegacyCouponRow = {
  isActive: true,
  validFrom: new Date('2026-10-01T00:00:00Z'),
  validTo: null,
  usageLimit: null,
  usedCount: 0,
  branchId: 'b1',
  branch: { restaurantId: 'r1' }
};

describe('isLegacyCouponUsable', () => {
  it('accepts a coupon at a branch of the creating restaurant', () => {
    expect(isLegacyCouponUsable(base, { restaurantId: 'r1', now })).toBe(true);
  });
  it('rejects a coupon at another restaurant', () => {
    expect(isLegacyCouponUsable(base, { restaurantId: 'r2', now })).toBe(false);
  });
  it('treats a branchless coupon as platform-wide', () => {
    expect(isLegacyCouponUsable({ ...base, branchId: null, branch: null }, { restaurantId: 'r2', now })).toBe(true);
  });
  it('rejects a coupon whose start date is in the future', () => {
    expect(isLegacyCouponUsable({ ...base, validFrom: new Date('2026-10-25T00:00:00Z') }, { restaurantId: 'r1', now })).toBe(false);
  });
  it('rejects expired, inactive and exhausted coupons', () => {
    expect(isLegacyCouponUsable({ ...base, validTo: new Date('2026-10-24T11:00:00Z') }, { restaurantId: 'r1', now })).toBe(false);
    expect(isLegacyCouponUsable({ ...base, isActive: false }, { restaurantId: 'r1', now })).toBe(false);
    expect(isLegacyCouponUsable({ ...base, usageLimit: 5, usedCount: 5 }, { restaurantId: 'r1', now })).toBe(false);
  });
});
