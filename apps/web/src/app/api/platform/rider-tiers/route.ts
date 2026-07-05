/**
 * GET /api/platform/rider-tiers — computes each rider's loyalty tier from
 * totalDeliveries + rating and returns the tier distribution + per-rider list.
 *
 * Thresholds (highest qualifying tier wins):
 *   PLATINUM  500+ deliveries & 4.6+ rating
 *   GOLD      200+ deliveries & 4.3+ rating
 *   SILVER     50+ deliveries & 4.0+ rating
 *   BRONZE    everyone else (0+)
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireCapability } from '@/server/tenancy';
import { computeTier, type RiderTier } from './_tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  await requireCapability('riders:read');

  const riders = await prisma.riderProfile.findMany({
    where: { approvedAt: { not: null } },
    include: { user: { select: { name: true, phone: true } } }
  });

  const rows = riders.map((r) => {
    const tier = computeTier(r.totalDeliveries, r.rating);
    return {
      id: r.id,
      name: r.user.name,
      phone: r.user.phone,
      riderType: r.riderType,
      totalDeliveries: r.totalDeliveries,
      rating: r.rating,
      totalEarnings: Number(r.totalEarnings),
      tier
    };
  });

  const distribution: Record<RiderTier, number> = { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 };
  for (const r of rows) distribution[r.tier]++;

  // Default sort: highest tier first, then most deliveries.
  const order: Record<RiderTier, number> = { PLATINUM: 0, GOLD: 1, SILVER: 2, BRONZE: 3 };
  rows.sort((a, b) => order[a.tier] - order[b.tier] || b.totalDeliveries - a.totalDeliveries);

  return Response.json({ riders: rows, distribution });
}
