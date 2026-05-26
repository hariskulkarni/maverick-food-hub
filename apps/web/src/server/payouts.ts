/**
 * Delivery payout calculator.
 * Uses the active DeliveryPayoutRule + branch→delivery haversine distance + order context.
 *
 * Components added on top of base+per-km:
 *   - first-km included (distance threshold)
 *   - long-distance tier (extra ₹/km beyond N km)
 *   - per-minute pay (active duration, when known)
 *   - lunch peak / dinner peak / late-night / weekend bonuses
 *   - COD handling fee (cash orders)
 *   - rider-share of order subtotal (%)
 *   - rain bonus (when activeRain=true)
 *   - performance milestones (computed at end-of-day or by the bonus job)
 *   - cancellation pay (% of base)
 *   - min / max caps
 *
 * ── Rider-specific overrides ────────────────────────────────────────────────
 * A Super Admin can attach a RiderPayoutOverride to an individual rider that
 * substitutes any subset of {basePay, perKmRate, minPayout, maxPayout,
 * codHandlingFee} on top of the active platform DeliveryPayoutRule. The merge
 * is implemented in `mergeRule()`; resolution of the effective rule lives in
 * `getEffectivePayoutRule()`. When `computeBasePayout` is called without a
 * `riderId` (e.g. when previewing pool earnings before a rider has claimed)
 * the resolver falls back to the platform default — the public API behaviour
 * for legacy callers is unchanged.
 */
import { prisma } from './db';
import { haversineKm } from '@/lib/utils';
import { tierSurgeShareBonus } from './rider-growth';

/**
 * Highest active surge multiplier whose circle covers `point` right now. A zone
 * is live when isActive and (if windowed) now falls inside [activeFrom, activeTo].
 * Returns 1 when no live zone covers the point (no surge). Picks the hottest
 * zone if several overlap.
 */
export async function resolveSurgeMultiplier(point: { lat: number | null; lng: number | null } | null): Promise<number> {
  if (!point || point.lat == null || point.lng == null) return 1;
  const now = new Date();
  const zones = await prisma.surgeZone.findMany({
    where: {
      isActive: true,
      OR: [{ activeFrom: null }, { activeFrom: { lte: now } }],
      AND: [{ OR: [{ activeTo: null }, { activeTo: { gte: now } }] }]
    },
    select: { centerLat: true, centerLng: true, radiusKm: true, multiplier: true }
  });
  let best = 1;
  for (const z of zones) {
    const d = haversineKm({ lat: point.lat, lng: point.lng }, { lat: z.centerLat, lng: z.centerLng });
    if (d <= z.radiusKm && z.multiplier > best) best = z.multiplier;
  }
  return best;
}

/**
 * The rider's tier surge-share bonus fraction from their lifetime stats. Returns
 * 0 (BRONZE / unknown rider) when no profile is found.
 */
export async function resolveTierSurgeShareBonus(riderId?: string | null): Promise<number> {
  if (!riderId) return 0;
  const p = await prisma.riderProfile.findUnique({
    where: { id: riderId },
    select: { totalDeliveries: true, rating: true }
  });
  if (!p) return 0;
  return tierSurgeShareBonus({ totalDeliveries: p.totalDeliveries ?? 0, rating: Number(p.rating ?? 0) });
}

interface ComputeOpts {
  /** Force the rain bonus on. Optional toggle in the dispatcher. */
  rainActive?: boolean;
  /** Active minutes for per-minute pay. Optional; default 0. */
  activeMinutes?: number;
  /** Wait minutes at pickup. Optional; default 0. */
  waitMinutes?: number;
  /** If set, merge this rider's active payout override on top of the platform default. */
  riderId?: string;
}

/**
 * Look up the active platform DeliveryPayoutRule plus (optionally) the active
 * RiderPayoutOverride for `riderId`, and return the merged rule together with
 * provenance info for UI labelling.
 *
 * `source: 'rider'` means at least one override field was applied. `'platform'`
 * means the platform default is in effect verbatim.
 */
export async function getEffectivePayoutRule(riderId?: string | null) {
  const now = new Date();
  const platformRule = await prisma.deliveryPayoutRule.findFirst({
    where: { isActive: true, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    orderBy: { effectiveFrom: 'desc' }
  });
  let override: any = null;
  if (riderId) {
    override = await prisma.riderPayoutOverride.findFirst({
      where: {
        riderId,
        isActive: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }]
      },
      orderBy: { effectiveFrom: 'desc' }
    });
  }
  const merged = mergeRule(platformRule, override);
  return {
    rule: merged,
    platformRule,
    override,
    source: override ? ('rider' as const) : ('platform' as const)
  };
}

/**
 * Pure merge of a RiderPayoutOverride onto a DeliveryPayoutRule. Override
 * values win when defined (non-null & non-undefined). Returns a plain object
 * that quacks like a DeliveryPayoutRule for `computeFromRule`.
 *
 * Defined here as a stand-alone function so it can be unit-tested without DB
 * round-trips and shared by the preview API.
 */
export function mergeRule(platformRule: any, override: any) {
  // computeFromRule guards against null and falls back to hard-coded defaults
  // (base ₹30, per-km ₹5, etc.) — so a missing platform rule is fine.
  const base: any = platformRule ? { ...platformRule } : {};
  if (!override) return base;
  // The five override knobs map to existing DeliveryPayoutRule fields.
  if (override.basePay != null)        base.baseAmount         = override.basePay;
  if (override.perKmRate != null)      base.perKmAmount        = override.perKmRate;
  if (override.minPayout != null)      base.minimumPerDelivery = override.minPayout;
  if (override.maxPayout != null)      base.maxPerDelivery     = override.maxPayout;
  if (override.codHandlingFee != null) base.codHandlingFee     = override.codHandlingFee;
  return base;
}

export async function computeBasePayout(orderId: string, opts: ComputeOpts = {}) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { branch: true, address: true }
  });
  const { rule } = await getEffectivePayoutRule(opts.riderId);

  // Surge is keyed on the delivery destination (where demand concentrates); the
  // tier share comes from the claiming rider. Both fall back to neutral (1 / 0)
  // when unavailable, so legacy callers without a riderId behave exactly as
  // before.
  const [surgeMultiplier, riderTierShare] = await Promise.all([
    resolveSurgeMultiplier(order.address ? { lat: order.address.latitude, lng: order.address.longitude } : null),
    resolveTierSurgeShareBonus(opts.riderId)
  ]);

  return computeFromRule(rule, {
    distanceKm: distanceFor(order),
    placedAt: new Date(),
    subtotal: Number(order.subtotal ?? 0),
    paymentMethod: order.paymentMethod,
    rainActive: opts.rainActive ?? false,
    activeMinutes: opts.activeMinutes ?? 0,
    waitMinutes: opts.waitMinutes ?? 0,
    surgeMultiplier,
    tierSurgeShareBonus: riderTierShare
  });
}

function distanceFor(order: { branch: { latitude: number | null; longitude: number | null }; address: { latitude: number | null; longitude: number | null } | null }): number {
  if (order.branch.latitude == null || order.branch.longitude == null) return 0;
  if (!order.address || order.address.latitude == null || order.address.longitude == null) return 0;
  return haversineKm(
    { lat: order.branch.latitude, lng: order.branch.longitude },
    { lat: order.address.latitude, lng: order.address.longitude }
  );
}

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
  const placed = ctx.placedAt;
  const mins = placed.getHours() * 60 + placed.getMinutes();
  const lunch  = mins >= num(r.lunchPeakStartMin, 720)  && mins < num(r.lunchPeakEndMin, 870);
  const dinner = mins >= num(r.dinnerPeakStartMin, 1140) && mins < num(r.dinnerPeakEndMin, 1380);
  const peakBonus = lunch ? num(r.lunchPeakBonus, 10) : dinner ? num(r.dinnerPeakBonus, 10) : 0;

  const lateNightStart = num(r.lateNightStartMin, 1320);
  const lateNight = mins >= lateNightStart || mins < 5 * 60; // crosses midnight: 22:00 → 05:00
  const lateNightBonus = lateNight ? num(r.lateNightBonus, 0) : 0;

  const dow = placed.getDay();
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
