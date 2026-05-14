/**
 * Rider growth — tier (loyalty ladder) logic and referral codes.
 *
 * The tier system turns lifetime stats (`totalDeliveries` + `rating`) into a
 * four-rung ladder — BRONZE → SILVER → GOLD → PLATINUM — each with a clear
 * requirement and a motivating perks list. `computeTier` is pure: given a
 * profile snapshot it returns the current rung, the next rung, progress toward
 * it, the current perks, and the full ladder for an "all tiers" overview.
 *
 * Referral codes are derived *deterministically* from the rider's profile id
 * (no storage needed) — the same rider always gets the same `RIDE-XXXXXX`
 * code, so the referrals route can hand it out without a dedicated table.
 */
import crypto from 'node:crypto';

export type TierName = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface TierDef {
  name: TierName;
  /** Minimum lifetime deliveries to reach this tier. */
  minDeliveries: number;
  /** Minimum rating to reach this tier. */
  minRating: number;
  /** Short human-readable requirement summary. */
  requirement: string;
  /** Motivating perks unlocked at this tier. */
  perks: string[];
}

/** The four rungs, ascending. BRONZE is the floor — everyone qualifies. */
export const TIERS: TierDef[] = [
  {
    name: 'BRONZE',
    minDeliveries: 0,
    minRating: 0,
    requirement: 'New riders — start here',
    perks: [
      'Access to the shared order pool',
      'Weekly earnings summary',
      'Standard in-app support',
    ],
  },
  {
    name: 'SILVER',
    minDeliveries: 50,
    minRating: 4.0,
    requirement: '50+ deliveries · 4.0+ rating',
    perks: [
      'Priority pool access during rush hours',
      '5% higher surge share',
      'Faster support response',
      'Eligible for weekly incentive challenges',
    ],
  },
  {
    name: 'GOLD',
    minDeliveries: 200,
    minRating: 4.3,
    requirement: '200+ deliveries · 4.3+ rating',
    perks: [
      'First pick on high-value orders',
      '12% higher surge share',
      'Dedicated priority support line',
      'Free accident insurance top-up',
      'Monthly fuel allowance bonus',
    ],
  },
  {
    name: 'PLATINUM',
    minDeliveries: 500,
    minRating: 4.6,
    requirement: '500+ deliveries · 4.6+ rating',
    perks: [
      'Guaranteed minimum daily earnings',
      '20% higher surge share',
      'Concierge support — skip the queue',
      'Premium health + accident insurance',
      'Exclusive partner discounts on servicing & fuel',
      'Invitation to the annual top-riders meet',
    ],
  },
];

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

/**
 * Deterministic, memorable referral code for a rider profile — `RIDE-XXXXXX`
 * where the suffix is six unambiguous base-32 chars (no 0/O/1/I/L) derived
 * from a SHA-256 of the profile id. Stable across calls, so it can be handed
 * out without persisting anything.
 */
export function genReferralCode(riderProfileId: string): string {
  // Crockford-ish alphabet — drops easily-confused characters.
  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const hash = crypto.createHash('sha256').update(String(riderProfileId)).digest();
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += ALPHABET[hash[i] % ALPHABET.length];
  }
  return `RIDE-${suffix}`;
}
