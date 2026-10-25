/**
 * Rider tier ladder (pure — safe for client components). Re-exported by
 * `src/server/rider-growth.ts`; the public earnings calculator imports it
 * directly so the marketing page and the pay engine share one definition.
 */
export type TierName = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface TierDef {
  name: TierName;
  /** Minimum lifetime deliveries to reach this tier. */
  minDeliveries: number;
  /** Minimum rating to reach this tier. */
  minRating: number;
  /** Short human-readable requirement summary. */
  requirement: string;
  /**
   * Extra share of the surge uplift this tier earns, as a fraction (0.05 = +5%).
   * This is the machine-readable counterpart to the "N% higher surge share"
   * perk string — the pay engine multiplies a delivery's surge bonus by
   * (1 + surgeShareBonus) so higher tiers genuinely take home more surge.
   */
  surgeShareBonus: number;
  /** Motivating perks unlocked at this tier. */
  perks: string[];
}

/**
 * The four rungs, ascending. BRONZE is the floor — everyone qualifies.
 * Perks list ONLY what the platform actually implements (surge share is paid by
 * the pay engine via `surgeShareBonus`); do not add promises (insurance,
 * guaranteed minimums, fuel allowance) until they exist.
 */
export const TIERS: TierDef[] = [
  {
    name: 'BRONZE',
    minDeliveries: 0,
    minRating: 0,
    requirement: 'New riders — start here',
    surgeShareBonus: 0,
    perks: [
      'Access to the shared order pool',
      'Downloadable earnings statement',
      'In-app support tickets',
    ],
  },
  {
    name: 'SILVER',
    minDeliveries: 50,
    minRating: 4.0,
    requirement: '50+ deliveries · 4.0+ rating',
    surgeShareBonus: 0.05,
    perks: ['5% extra on surge pay', 'Everything in Bronze'],
  },
  {
    name: 'GOLD',
    minDeliveries: 200,
    minRating: 4.3,
    requirement: '200+ deliveries · 4.3+ rating',
    surgeShareBonus: 0.12,
    perks: ['12% extra on surge pay', 'Everything in Bronze'],
  },
  {
    name: 'PLATINUM',
    minDeliveries: 500,
    minRating: 4.6,
    requirement: '500+ deliveries · 4.6+ rating',
    surgeShareBonus: 0.20,
    perks: ['20% extra on surge pay', 'Everything in Bronze'],
  },
];

/**
 * The surge-share bonus fraction for a rider's current tier, derived from the
 * same lifetime stats `computeTier` uses. BRONZE → 0; PLATINUM → 0.20. Pure so
 * the pay engine and tests can call it without DB access.
 */
export function tierSurgeShareBonus(profile: ProfileStats): number {
  return computeTier(profile).current.surgeShareBonus;
}

interface ProfileStats {
  totalDeliveries: number;
  rating: number;
}

function qualifies(tier: TierDef, p: ProfileStats): boolean {
  return p.totalDeliveries >= tier.minDeliveries && p.rating >= tier.minRating;
}

export interface ComputedTier {
  current: TierDef;
  /** The next rung up, or null if already PLATINUM. */
  next: TierDef | null;
  /** 0–1 progress from the current rung's floor to the next rung's bar. */
  progressToNext: number;
  /** Perks unlocked at the current tier. */
  perks: string[];
  /** Full ladder, each flagged with `achieved`. */
  allTiers: (TierDef & { achieved: boolean })[];
}

/**
 * Resolve a rider's tier from their lifetime stats. The current tier is the
 * highest rung they qualify for; progress blends delivery-count progress and
 * rating progress toward the next rung (whichever they're further behind on
 * drives the bar, so the number is honest).
 */
export function computeTier(profile: ProfileStats): ComputedTier {
  const deliveries = Number.isFinite(profile.totalDeliveries)
    ? Math.max(0, profile.totalDeliveries)
    : 0;
  const rating = Number.isFinite(profile.rating) ? Math.max(0, profile.rating) : 0;
  const stats: ProfileStats = { totalDeliveries: deliveries, rating };

  // Highest rung the rider qualifies for (TIERS is ascending; BRONZE always passes).
  let currentIdx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (qualifies(TIERS[i], stats)) currentIdx = i;
  }
  const current = TIERS[currentIdx];
  const next = currentIdx < TIERS.length - 1 ? TIERS[currentIdx + 1] : null;

  let progressToNext = 1;
  if (next) {
    // Delivery progress: from the current floor to the next bar.
    const delSpan = next.minDeliveries - current.minDeliveries;
    const delProgress =
      delSpan > 0
        ? Math.min(1, Math.max(0, (deliveries - current.minDeliveries) / delSpan))
        : 1;
    // Rating progress: from the current floor to the next bar.
    const rateSpan = next.minRating - current.minRating;
    const rateProgress =
      rateSpan > 0
        ? Math.min(1, Math.max(0, (rating - current.minRating) / rateSpan))
        : 1;
    // Both gates must be cleared — the weaker one is the true bottleneck.
    progressToNext = Math.min(delProgress, rateProgress);
  }

  return {
    current,
    next,
    progressToNext,
    perks: current.perks,
    allTiers: TIERS.map((t, i) => ({ ...t, achieved: i <= currentIdx })),
  };
}
