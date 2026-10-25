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
import { computeFromRule } from '@/lib/payout-math';

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

export { computeFromRule } from '@/lib/payout-math';
export type { CalcContext, CalcBreakdown } from '@/lib/payout-math';
