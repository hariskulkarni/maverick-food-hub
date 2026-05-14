import { prisma } from '@/server/db';
import { Card, CardContent } from '@/components/ui/card';
import { Award } from 'lucide-react';
import { RiderTiersClient, type TierRow, type RiderTier } from './rider-tiers-client';

export const metadata = { title: 'Platform · Rider tiers' };
export const dynamic = 'force-dynamic';

/**
 * Loyalty-tier thresholds (highest qualifying tier wins). Kept in sync with
 * /api/platform/rider-tiers — see computeTier there.
 */
function computeTier(totalDeliveries: number, rating: number): RiderTier {
  if (totalDeliveries >= 500 && rating >= 4.6) return 'PLATINUM';
  if (totalDeliveries >= 200 && rating >= 4.3) return 'GOLD';
  if (totalDeliveries >= 50 && rating >= 4.0) return 'SILVER';
  return 'BRONZE';
}

export default async function RiderTiersPage() {
  const riders = await prisma.riderProfile.findMany({
    where: { approvedAt: { not: null } },
    include: { user: { select: { name: true, phone: true } } }
  });

  const rows: TierRow[] = riders.map((r) => ({
    id: r.id,
    name: r.user.name,
    phone: r.user.phone,
    riderType: r.riderType,
    totalDeliveries: r.totalDeliveries,
    rating: r.rating,
    totalEarnings: Number(r.totalEarnings),
    tier: computeTier(r.totalDeliveries, r.rating)
  }));

  const distribution: Record<RiderTier, number> = { BRONZE: 0, SILVER: 0, GOLD: 0, PLATINUM: 0 };
  for (const r of rows) distribution[r.tier]++;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold flex items-center gap-2">
          <Award className="size-7 text-primary" /> Rider tiers
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Loyalty tiers computed from lifetime deliveries and rating. Bronze 0+ · Silver 50+ &amp; 4.0★ ·
          Gold 200+ &amp; 4.3★ · Platinum 500+ &amp; 4.6★.
        </p>
      </header>

      {rows.length === 0 ? (
        <Card><CardContent className="p-12 text-center text-muted-foreground">No approved riders yet.</CardContent></Card>
      ) : (
        <RiderTiersClient rows={rows} distribution={distribution} />
      )}
    </div>
  );
}
