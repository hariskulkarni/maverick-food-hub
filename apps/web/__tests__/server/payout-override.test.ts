/**
 * Unit tests for the rider-specific payout override merge logic.
 *
 * `mergeRule` is the pure heart of the override feature — it takes the
 * platform-wide DeliveryPayoutRule and a RiderPayoutOverride and returns the
 * effective rule the calculator should use. Override values win when defined;
 * null/undefined inherit the platform default. We then run a few canned
 * scenarios through `computeFromRule(merged, ctx)` to verify the override
 * actually changes the final payout in the expected direction.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/server/db', () => ({ prisma: {} }));

import { computeFromRule, mergeRule, type CalcContext } from '@/server/payouts';

const platformRule = {
  baseAmount: 30,
  perKmAmount: 5,
  firstKmIncluded: 1,
  longDistanceThresholdKm: 5,
  longDistanceBonusPerKm: 0,
  perMinuteAmount: 0,
  lunchPeakStartMin: 720, lunchPeakEndMin: 870, lunchPeakBonus: 10,
  dinnerPeakStartMin: 1140, dinnerPeakEndMin: 1380, dinnerPeakBonus: 10,
  lateNightStartMin: 1320, lateNightBonus: 0,
  weekendBonus: 0,
  rainBonus: 15,
  codHandlingFee: 0,
  orderValueSharePct: 0,
  ratingBonusThreshold: 0, ratingBonusAmount: 0,
  dailyTripBonusThreshold: 0, dailyTripBonusAmount: 0,
  weeklyTripBonusThreshold: 0, weeklyTripBonusAmount: 0,
  waitTimeStartMin: 10, waitTimePerMin: 1,
  cancellationPayPct: 50,
  minimumPerDelivery: 0,
  maxPerDelivery: 0
};

// 11:00 Wed — outside all peak/late-night/weekend windows so we isolate the
// override effect cleanly.
const ctxFor = (overrides: Partial<CalcContext> = {}): CalcContext => ({
  distanceKm: 3,
  placedAt: new Date('2026-05-13T11:00:00'),
  subtotal: 400,
  paymentMethod: 'RAZORPAY',
  rainActive: false,
  activeMinutes: 0,
  waitMinutes: 0,
  ...overrides
});

describe('mergeRule', () => {
  it('returns the platform rule unchanged when override is null', () => {
    const merged = mergeRule(platformRule, null);
    expect(merged.baseAmount).toBe(30);
    expect(merged.perKmAmount).toBe(5);
    expect(merged.codHandlingFee).toBe(0);
  });

  it('returns the platform rule unchanged when override has only null fields', () => {
    const merged = mergeRule(platformRule, { basePay: null, perKmRate: null, minPayout: null, maxPayout: null, codHandlingFee: null });
    expect(merged.baseAmount).toBe(30);
    expect(merged.perKmAmount).toBe(5);
  });

  it('replaces only the fields the override sets', () => {
    const merged = mergeRule(platformRule, { basePay: 50, perKmRate: 8 });
    expect(merged.baseAmount).toBe(50);
    expect(merged.perKmAmount).toBe(8);
    // Other platform values stay intact
    expect(merged.lunchPeakBonus).toBe(10);
    expect(merged.rainBonus).toBe(15);
    expect(merged.firstKmIncluded).toBe(1);
  });

  it('maps each override knob to its DeliveryPayoutRule field', () => {
    const merged = mergeRule(platformRule, {
      basePay: 40, perKmRate: 7, minPayout: 60, maxPayout: 200, codHandlingFee: 12
    });
    expect(merged.baseAmount).toBe(40);
    expect(merged.perKmAmount).toBe(7);
    expect(merged.minimumPerDelivery).toBe(60);
    expect(merged.maxPerDelivery).toBe(200);
    expect(merged.codHandlingFee).toBe(12);
  });

  it('falls back to hard-coded defaults when platform rule is also null', () => {
    // mergeRule(null, override) should still produce something usable so
    // computeFromRule's defaults kick in for any unspecified field.
    const merged = mergeRule(null, { basePay: 25 });
    expect(merged.baseAmount).toBe(25);
    // perKmAmount missing here — computeFromRule will use its built-in 5.
    expect(merged.perKmAmount).toBeUndefined();
    const result = computeFromRule(merged, ctxFor());
    // base 25 + 2 km × ₹5 = 35
    expect(result.baseAmount).toBe(25);
    expect(result.perKmAmount).toBe(10);
  });
});

describe('computeFromRule + override', () => {
  it('rider with a higher base earns more than platform default', () => {
    const ctx = ctxFor({ distanceKm: 3 });
    const platform = computeFromRule(platformRule, ctx);
    const override = computeFromRule(mergeRule(platformRule, { basePay: 50 }), ctx);
    // Base goes up by 20; per-km, peak bonuses unchanged.
    expect(override.payout - platform.payout).toBeCloseTo(20, 2);
  });

  it('rider per-km override changes long-leg payout proportionally', () => {
    const ctx = ctxFor({ distanceKm: 4 }); // 3 km billable after first-km-included
    const platform = computeFromRule(platformRule, ctx);
    const override = computeFromRule(mergeRule(platformRule, { perKmRate: 10 }), ctx);
    // 3 km × (10 - 5) = +15
    expect(override.payout - platform.payout).toBeCloseTo(15, 2);
  });

  it('min payout floor lifts a tiny-distance trip', () => {
    const ctx = ctxFor({ distanceKm: 0.5, subtotal: 100 });
    const platform = computeFromRule(platformRule, ctx);
    // Platform: base 30, no per-km (within firstKm), no bonuses → 30
    expect(platform.payout).toBe(30);
    const override = computeFromRule(mergeRule(platformRule, { minPayout: 60 }), ctx);
    expect(override.payout).toBe(60);
    expect(override.applied.floor).toBe(60);
  });

  it('max payout caps a long-distance trip', () => {
    const ctx = ctxFor({ distanceKm: 12, subtotal: 200 });
    const platform = computeFromRule(platformRule, ctx);
    // Platform: base 30 + 11 km billable × ₹5 (no long-distance bonus in fixture) = ₹50
    expect(platform.payout).toBe(50);
    // A ₹40 ceiling should clamp the same trip
    const override = computeFromRule(mergeRule(platformRule, { maxPayout: 40 }), ctx);
    expect(override.payout).toBe(40);
    expect(override.applied.ceiling).toBe(40);
  });

  it('COD handling fee override is added on cash orders only', () => {
    const codCtx  = ctxFor({ paymentMethod: 'COD' });
    const upiCtx  = ctxFor({ paymentMethod: 'RAZORPAY' });
    const merged  = mergeRule(platformRule, { codHandlingFee: 25 });
    expect(computeFromRule(merged, codCtx).codFee).toBe(25);
    expect(computeFromRule(merged, upiCtx).codFee).toBe(0);
  });

  it('override does not retroactively change the underlying platform rule object', () => {
    // Sanity: mergeRule should not mutate its input.
    const before = JSON.stringify(platformRule);
    mergeRule(platformRule, { basePay: 999, perKmRate: 999, minPayout: 999, maxPayout: 999, codHandlingFee: 999 });
    expect(JSON.stringify(platformRule)).toBe(before);
  });
});
