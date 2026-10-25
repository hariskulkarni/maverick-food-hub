/**
 * Pure delivery-payout maths, shared by the server pay engine
 * (`src/server/payouts.ts`) and the public rider earnings calculator (client
 * component). No DB / Node imports so it is safe in the browser bundle.
 *
 * Time-based bonuses (lunch/dinner peak, late night, weekend) are evaluated on
 * the IST wall clock of `placedAt`, whatever TZ the server runs in.
 */
import { istParts } from './ist';

export interface CalcContext {
  distanceKm: number;
  placedAt: Date;
  subtotal: number;
  paymentMethod?: string | null;
  rainActive?: boolean;
  activeMinutes?: number;
  waitMinutes?: number;
  /**
   * Active surge multiplier covering the delivery (e.g. 1.5 = +50%). 1 or less
   * means no surge. Applied to the core delivery components (base + distance +
   * per-minute) as a surge bonus line.
   */
  surgeMultiplier?: number;
  /**
   * The rider's tier surge-share bonus fraction (e.g. 0.20 = +20%). Scales the
   * surge bonus only — higher tiers keep more of the surge uplift. Has no
   * effect when there's no surge.
   */
  tierSurgeShareBonus?: number;
  /** Pass these in if you're computing payouts at end-of-day with a rider's stats. */
  riderTripsTodayBeforeThis?: number;
  riderTripsThisWeekBeforeThis?: number;
  riderRating?: number;
  /** If true, the customer cancelled post-pickup — applies cancellationPayPct. */
  cancelled?: boolean;
}

export interface CalcBreakdown {
  baseAmount: number;
  distanceKm: number;
  perKmAmount: number;
  longDistanceAmount: number;
  perMinuteAmount: number;
  peakBonus: number;
  lateNightBonus: number;
  weekendBonus: number;
  rainBonus: number;
  codFee: number;
  orderShare: number;
  ratingBonus: number;
  dailyMilestoneBonus: number;
  weeklyMilestoneBonus: number;
  waitTimeAmount: number;
  cancellationAdj: number;
  surgeMultiplier: number;   // 1 when no surge
  surgeBonus: number;        // extra ₹ from surge (incl. tier share), 0 when none
  tierSurgeShareBonus: number; // fraction applied to surge uplift (0 = BRONZE)
  subtotal: number;          // sum before cap
  applied: { floor: number; ceiling: number };
  payout: number;            // final, after floor/ceiling
}

export function computeFromRule(rule: any, ctx: CalcContext): CalcBreakdown {
  // Sensible defaults if no rule exists
  const r = rule ?? {};
  const num = (v: any, fallback = 0) => (v == null ? fallback : Number(v));
  const base    = num(r.baseAmount, 30);
  const perKm   = num(r.perKmAmount, 5);
  const firstKm = num(r.firstKmIncluded, 1);
  const ldThr   = num(r.longDistanceThresholdKm, 5);
  const ldPerKm = num(r.longDistanceBonusPerKm, 0);
  const perMin  = num(r.perMinuteAmount, 0);

  // Distance breakdown
  const km = Math.max(0, ctx.distanceKm);
  const beyondFirst = Math.max(0, km - firstKm);
  const longDistanceKm = Math.max(0, km - ldThr);
  const baseDistanceKm = beyondFirst - longDistanceKm;
  const perKmAmount       = +(perKm  * Math.max(0, baseDistanceKm)).toFixed(2);
  const longDistanceAmount = +(ldPerKm * longDistanceKm).toFixed(2);
  const perMinuteAmount    = +(perMin * (ctx.activeMinutes ?? 0)).toFixed(2);

  // Time-based bonuses
  // All time windows are IST wall-clock (P1-16) — independent of server TZ.
  const placedIst = istParts(ctx.placedAt);
  const mins = placedIst.minutesOfDay;
  const lunch  = mins >= num(r.lunchPeakStartMin, 720)  && mins < num(r.lunchPeakEndMin, 870);
  const dinner = mins >= num(r.dinnerPeakStartMin, 1140) && mins < num(r.dinnerPeakEndMin, 1380);
  const peakBonus = lunch ? num(r.lunchPeakBonus, 10) : dinner ? num(r.dinnerPeakBonus, 10) : 0;

  const lateNightStart = num(r.lateNightStartMin, 1320);
  const lateNight = mins >= lateNightStart || mins < 5 * 60; // crosses midnight: 22:00 → 05:00
  const lateNightBonus = lateNight ? num(r.lateNightBonus, 0) : 0;

  const dow = placedIst.dayOfWeek;
  const weekendBonus = (dow === 0 || dow === 6) ? num(r.weekendBonus, 0) : 0;

  // Conditions
  const rainBonus = ctx.rainActive ? num(r.rainBonus, 15) : 0;
  const codFee = ctx.paymentMethod === 'COD' ? num(r.codHandlingFee, 0) : 0;
  const orderShare = +(num(r.orderValueSharePct, 0) / 100 * ctx.subtotal).toFixed(2);

  // Quality / performance
  const ratingBonus = (ctx.riderRating != null && ctx.riderRating >= num(r.ratingBonusThreshold, 0) && num(r.ratingBonusThreshold, 0) > 0)
    ? num(r.ratingBonusAmount, 0) : 0;

  // Daily / weekly milestones (only apply on the trip that hits the threshold)
  const dailyTh = num(r.dailyTripBonusThreshold, 0);
  const weeklyTh = num(r.weeklyTripBonusThreshold, 0);
  const dailyMilestoneBonus = (dailyTh > 0 && (ctx.riderTripsTodayBeforeThis ?? 0) + 1 === dailyTh)
    ? num(r.dailyTripBonusAmount, 0) : 0;
  const weeklyMilestoneBonus = (weeklyTh > 0 && (ctx.riderTripsThisWeekBeforeThis ?? 0) + 1 === weeklyTh)
    ? num(r.weeklyTripBonusAmount, 0) : 0;

  // Wait time
  const waitStart = num(r.waitTimeStartMin, 10);
  const waitPerMin = num(r.waitTimePerMin, 1);
  const waitMins = Math.max(0, (ctx.waitMinutes ?? 0) - waitStart);
  const waitTimeAmount = +(waitMins * waitPerMin).toFixed(2);

  // Cancellation
  let cancellationAdj = 0;
  if (ctx.cancelled) {
    const pct = num(r.cancellationPayPct, 50);
    cancellationAdj = -((100 - pct) / 100) * base;
  }

  // Surge: a multiplier (>1) on the *core delivery effort* (base + distance +
  // per-minute) gives a surge uplift. The rider's tier surge-share bonus then
  // scales that uplift so higher tiers keep more of it. No surge → no bonus,
  // and the tier share is irrelevant. We clamp the multiplier at 1 so a
  // misconfigured <1 zone can never dock pay.
  const surgeMultiplier = Math.max(1, ctx.surgeMultiplier ?? 1);
  const tierShare = Math.max(0, ctx.tierSurgeShareBonus ?? 0);
  const surgeCore = base + perKmAmount + longDistanceAmount + perMinuteAmount;
  const surgeUplift = surgeCore * (surgeMultiplier - 1);
  const surgeBonus = +(surgeUplift * (1 + tierShare)).toFixed(2);

  const subtotal =
    base + perKmAmount + longDistanceAmount + perMinuteAmount +
    peakBonus + lateNightBonus + weekendBonus + rainBonus + codFee + orderShare +
    ratingBonus + dailyMilestoneBonus + weeklyMilestoneBonus + waitTimeAmount + cancellationAdj +
    surgeBonus;

  const minP = num(r.minimumPerDelivery, 0);
  const maxP = num(r.maxPerDelivery, 0);
  const floored = minP > 0 ? Math.max(subtotal, minP) : subtotal;
  const payout = maxP > 0 ? Math.min(floored, maxP) : floored;

  return {
    baseAmount: base,
    distanceKm: +km.toFixed(2),
    perKmAmount,
    longDistanceAmount,
    perMinuteAmount,
    peakBonus,
    lateNightBonus,
    weekendBonus,
    rainBonus,
    codFee,
    orderShare,
    ratingBonus,
    dailyMilestoneBonus,
    weeklyMilestoneBonus,
    waitTimeAmount,
    cancellationAdj: +cancellationAdj.toFixed(2),
    surgeMultiplier: +surgeMultiplier.toFixed(2),
    surgeBonus,
    tierSurgeShareBonus: tierShare,
    subtotal: +subtotal.toFixed(2),
    applied: { floor: minP, ceiling: maxP },
    payout: +payout.toFixed(2)
  };
}
