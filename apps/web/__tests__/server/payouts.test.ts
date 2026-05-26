import { describe, it, expect, vi, beforeEach } from 'vitest';

// Avoid instantiating the real PrismaClient when payouts.ts is loaded.
vi.mock('@/server/db', () => ({ prisma: {} }));

import { computeFromRule, type CalcContext } from '@/server/payouts';

const defaultRule = {
  baseAmount: 30,
  perKmAmount: 5,
  firstKmIncluded: 1,
  longDistanceThresholdKm: 5,
  longDistanceBonusPerKm: 3,
  perMinuteAmount: 0,
  lunchPeakStartMin: 720,   // 12:00
  lunchPeakEndMin: 870,     // 14:30
  lunchPeakBonus: 10,
  dinnerPeakStartMin: 1140, // 19:00
  dinnerPeakEndMin: 1380,   // 23:00
  dinnerPeakBonus: 12,
  lateNightStartMin: 1320,  // 22:00
  lateNightBonus: 20,
  weekendBonus: 25,
  rainBonus: 15,
  codHandlingFee: 5,
  orderValueSharePct: 0,
  ratingBonusThreshold: 4.8,
  ratingBonusAmount: 10,
  dailyTripBonusThreshold: 10,
  dailyTripBonusAmount: 100,
  weeklyTripBonusThreshold: 50,
  weeklyTripBonusAmount: 500,
  waitTimeStartMin: 10,
  waitTimePerMin: 2,
  cancellationPayPct: 50,
  minimumPerDelivery: 0,
  maxPerDelivery: 0
};

// A Monday afternoon (3pm) — outside lunch, dinner, late-night, weekend windows.
function neutralAfternoon(): Date {
  // 2026-05-11 (Monday) 15:00 IST → use local-time constructor so getDay/getHours match.
  return new Date(2026, 4, 11, 15, 0, 0);
}

const baseCtx = (over: Partial<CalcContext> = {}): CalcContext => ({
  distanceKm: 0,
  placedAt: neutralAfternoon(),
  subtotal: 0,
  ...over
});

describe('payouts.computeFromRule — base + perKm + long distance', () => {
  it('charges perKm only beyond the first included km', () => {
    const r = computeFromRule(defaultRule, baseCtx({ distanceKm: 3 }));
    // baseDistanceKm = 3 - 1 - 0 = 2 → 2 * 5 = 10
    expect(r.perKmAmount).toBe(10);
    expect(r.longDistanceAmount).toBe(0);
  });

  it('adds the long-distance bonus beyond the threshold', () => {
    const r = computeFromRule(defaultRule, baseCtx({ distanceKm: 8 }));
    // base km = (8 - 1) - (8 - 5) = 4 → 4 * 5 = 20
    // long  km = 3 → 3 * 3 = 9
    expect(r.perKmAmount).toBe(20);
    expect(r.longDistanceAmount).toBe(9);
  });
});

describe('payouts.computeFromRule — peak boundaries', () => {
  it('applies lunch bonus at 12:00 (inclusive start)', () => {
    const placed = new Date(2026, 4, 11, 12, 0, 0);
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: placed }));
    expect(r.peakBonus).toBe(10);
  });

  it('drops lunch bonus at 14:30 (exclusive end)', () => {
    const placed = new Date(2026, 4, 11, 14, 30, 0);
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: placed }));
    expect(r.peakBonus).toBe(0);
  });

  it('applies dinner bonus at 19:00 (inclusive start)', () => {
    const placed = new Date(2026, 4, 11, 19, 0, 0);
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: placed }));
    expect(r.peakBonus).toBe(12);
  });

  it('drops dinner bonus at 23:00 (exclusive end)', () => {
    const placed = new Date(2026, 4, 11, 23, 0, 0);
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: placed }));
    expect(r.peakBonus).toBe(0);
  });
});

describe('payouts.computeFromRule — late night across midnight', () => {
  it('pays the late-night bonus at 23:00', () => {
    const placed = new Date(2026, 4, 11, 23, 0, 0);
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: placed }));
    expect(r.lateNightBonus).toBe(20);
  });

  it('pays the late-night bonus at 02:30 (post-midnight)', () => {
    const placed = new Date(2026, 4, 12, 2, 30, 0);
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: placed }));
    expect(r.lateNightBonus).toBe(20);
  });

  it('does not pay late-night at 15:00', () => {
    const r = computeFromRule(defaultRule, baseCtx());
    expect(r.lateNightBonus).toBe(0);
  });
});

describe('payouts.computeFromRule — weekend bonus', () => {
  it('pays weekendBonus on a Saturday', () => {
    const sat = new Date(2026, 4, 9, 15, 0, 0); // 2026-05-09 = Saturday
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: sat }));
    expect(r.weekendBonus).toBe(25);
  });

  it('pays weekendBonus on a Sunday', () => {
    const sun = new Date(2026, 4, 10, 15, 0, 0); // 2026-05-10 = Sunday
    const r = computeFromRule(defaultRule, baseCtx({ placedAt: sun }));
    expect(r.weekendBonus).toBe(25);
  });

  it('does not pay weekendBonus on a weekday', () => {
    const r = computeFromRule(defaultRule, baseCtx());
    expect(r.weekendBonus).toBe(0);
  });
});

describe('payouts.computeFromRule — rain', () => {
  it('adds rain bonus when rainActive=true', () => {
    const r = computeFromRule(defaultRule, baseCtx({ rainActive: true }));
    expect(r.rainBonus).toBe(15);
  });

  it('does not add rain bonus otherwise', () => {
    const r = computeFromRule(defaultRule, baseCtx({ rainActive: false }));
    expect(r.rainBonus).toBe(0);
  });
});

describe('payouts.computeFromRule — COD + order share', () => {
  it('adds COD handling fee on COD orders', () => {
    const r = computeFromRule(defaultRule, baseCtx({ paymentMethod: 'COD' }));
    expect(r.codFee).toBe(5);
  });

  it('skips COD fee on non-COD orders', () => {
    const r = computeFromRule(defaultRule, baseCtx({ paymentMethod: 'RAZORPAY' }));
    expect(r.codFee).toBe(0);
  });

  it('applies order-value share as a percentage of subtotal', () => {
    const r = computeFromRule(
      { ...defaultRule, orderValueSharePct: 10 },
      baseCtx({ subtotal: 250 })
    );
    expect(r.orderShare).toBe(25);
  });
});

describe('payouts.computeFromRule — milestones', () => {
  it('pays daily milestone only on the trip that hits the threshold', () => {
    const justBefore = computeFromRule(defaultRule, baseCtx({ riderTripsTodayBeforeThis: 8 }));
    const hit       = computeFromRule(defaultRule, baseCtx({ riderTripsTodayBeforeThis: 9 }));
    const past      = computeFromRule(defaultRule, baseCtx({ riderTripsTodayBeforeThis: 10 }));
    expect(justBefore.dailyMilestoneBonus).toBe(0);
    expect(hit.dailyMilestoneBonus).toBe(100);
    expect(past.dailyMilestoneBonus).toBe(0);
  });

  it('pays weekly milestone only on the trip that hits the threshold', () => {
    const hit = computeFromRule(defaultRule, baseCtx({ riderTripsThisWeekBeforeThis: 49 }));
    const past = computeFromRule(defaultRule, baseCtx({ riderTripsThisWeekBeforeThis: 50 }));
    expect(hit.weeklyMilestoneBonus).toBe(500);
    expect(past.weeklyMilestoneBonus).toBe(0);
  });
});

describe('payouts.computeFromRule — rating bonus', () => {
  it('pays the rating bonus when rider rating meets the threshold', () => {
    const r = computeFromRule(defaultRule, baseCtx({ riderRating: 4.9 }));
    expect(r.ratingBonus).toBe(10);
  });

  it('skips the rating bonus below the threshold', () => {
    const r = computeFromRule(defaultRule, baseCtx({ riderRating: 4.5 }));
    expect(r.ratingBonus).toBe(0);
  });
});

describe('payouts.computeFromRule — wait time', () => {
  it('pays only the minutes beyond the wait threshold', () => {
    const r = computeFromRule(defaultRule, baseCtx({ waitMinutes: 15 }));
    // (15 - 10) * 2 = 10
    expect(r.waitTimeAmount).toBe(10);
  });

  it('pays nothing under the wait threshold', () => {
    const r = computeFromRule(defaultRule, baseCtx({ waitMinutes: 5 }));
    expect(r.waitTimeAmount).toBe(0);
  });
});

describe('payouts.computeFromRule — cancellation', () => {
  it('reduces payout by (100 - cancellationPayPct)% of base when cancelled', () => {
    const r = computeFromRule(defaultRule, baseCtx({ cancelled: true }));
    // base=30, pct=50 → cancellationAdj = -((100-50)/100) * 30 = -15
    expect(r.cancellationAdj).toBe(-15);
  });
});

describe('payouts.computeFromRule — surge + tier share', () => {
  // A clean rule: only base + per-km so the surge core is easy to reason about.
  const surgeRule = { ...defaultRule, baseAmount: 30, perKmAmount: 5, firstKmIncluded: 1, longDistanceBonusPerKm: 0, codHandlingFee: 0 };

  it('no surge (multiplier ≤ 1) → no surge bonus', () => {
    const r = computeFromRule(surgeRule, baseCtx({ distanceKm: 3, surgeMultiplier: 1 }));
    expect(r.surgeBonus).toBe(0);
    expect(r.surgeMultiplier).toBe(1);
  });

  it('clamps a misconfigured <1 multiplier to 1 (never docks pay)', () => {
    const r = computeFromRule(surgeRule, baseCtx({ distanceKm: 3, surgeMultiplier: 0.5 }));
    expect(r.surgeBonus).toBe(0);
    expect(r.surgeMultiplier).toBe(1);
  });

  it('applies surge uplift to the core (base + distance) with no tier bonus', () => {
    // base 30 + perKm (3-1)*5=10 → core 40; 1.5x → uplift 40*0.5 = 20
    const r = computeFromRule(surgeRule, baseCtx({ distanceKm: 3, surgeMultiplier: 1.5 }));
    expect(r.surgeBonus).toBe(20);
    expect(r.payout).toBe(60); // 40 core + 20 surge
  });

  it('scales the surge uplift by the tier surge-share bonus', () => {
    // core 40, 1.5x uplift 20, PLATINUM +20% → 20 * 1.2 = 24
    const r = computeFromRule(surgeRule, baseCtx({ distanceKm: 3, surgeMultiplier: 1.5, tierSurgeShareBonus: 0.2 }));
    expect(r.surgeBonus).toBe(24);
    expect(r.tierSurgeShareBonus).toBe(0.2);
  });

  it('tier share is irrelevant when there is no surge', () => {
    const r = computeFromRule(surgeRule, baseCtx({ distanceKm: 3, surgeMultiplier: 1, tierSurgeShareBonus: 0.2 }));
    expect(r.surgeBonus).toBe(0);
  });
});

describe('payouts.computeFromRule — floor and ceiling', () => {
  it('lifts payout to the floor when subtotal is below the minimum', () => {
    const rule = { ...defaultRule, baseAmount: 5, perKmAmount: 0, minimumPerDelivery: 50, maxPerDelivery: 0 };
    const r = computeFromRule(rule, baseCtx());
    expect(r.payout).toBe(50);
    expect(r.applied.floor).toBe(50);
  });

  it('caps payout at the ceiling when subtotal exceeds the maximum', () => {
    const rule = { ...defaultRule, baseAmount: 500, perKmAmount: 0, minimumPerDelivery: 0, maxPerDelivery: 200 };
    const r = computeFromRule(rule, baseCtx());
    expect(r.payout).toBe(200);
    expect(r.applied.ceiling).toBe(200);
  });
});
