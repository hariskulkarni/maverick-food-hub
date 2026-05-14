/**
 * Rider loyalty-tier computation. Lives outside `route.ts` because a Next.js
 * route file may only export HTTP handlers + route config.
 *
 * Thresholds (highest qualifying tier wins):
 *   PLATINUM  500+ deliveries & 4.6+ rating
 *   GOLD      200+ deliveries & 4.3+ rating
 *   SILVER     50+ deliveries & 4.0+ rating
 *   BRONZE    everyone else (0+)
 */
export type RiderTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export function computeTier(totalDeliveries: number, rating: number): RiderTier {
  if (totalDeliveries >= 500 && rating >= 4.6) return 'PLATINUM';
  if (totalDeliveries >= 200 && rating >= 4.3) return 'GOLD';
  if (totalDeliveries >= 50 && rating >= 4.0) return 'SILVER';
  return 'BRONZE';
}
