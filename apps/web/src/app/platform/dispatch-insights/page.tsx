/**
 * /platform/dispatch-insights — super-admin dispatch KPIs, zone supply/demand
 * heat table and the JIT rider-invitation setting. Data comes from
 * /api/platform/dispatch-insights (aggregate SQL; IST day boundaries).
 */
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { defaultRange } from '@/server/dispatch/insights';
import { DispatchInsightsClient } from './dispatch-insights-client';

export const metadata = { title: 'Platform · Dispatch insights' };
export const dynamic = 'force-dynamic';

export default async function DispatchInsightsPage() {
  await requireSuperAdmin();
  const [restaurants, cities] = await Promise.all([
    prisma.restaurant.findMany({
      where: { deletedAt: null, status: 'ACTIVE', id: { not: '__platform__' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    prisma.branch.findMany({ where: { isActive: true }, distinct: ['city'], select: { city: true }, orderBy: { city: 'asc' }, take: 200 }),
  ]);
  return (
    <div className="p-4 sm:p-6">
      <DispatchInsightsClient
        initialRange={defaultRange()}
        restaurants={restaurants}
        cities={cities.map((c) => c.city).filter(Boolean)}
      />
    </div>
  );
}
