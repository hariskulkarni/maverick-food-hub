/**
 * Platform · Feedback
 *
 * Server component. Loads the last-30-day summary aggregated by
 * restaurant and by rider for the Overview/By Rider tabs, plus a flat
 * "recent" list (full SUPER_ADMIN visibility — no redaction). Heavy
 * filtering lives in the client.
 */
import { requireCapability } from '@/server/tenancy';
import { visibleForRole, summariseRatings } from '@/server/feedback';
import { prisma } from '@/server/db';
import { FeedbackClient } from './feedback-client';

export const metadata = { title: 'Platform · Feedback' };
export const dynamic = 'force-dynamic';

export default async function PlatformFeedbackPage() {
  await requireCapability('ops:read');

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);

  const rows = await (prisma as any).orderFeedback.findMany({
    where: { createdAt: { gte: from, lt: to } },
    include: {
      order: {
        select: {
          code: true,
          total: true,
          branch: { select: { restaurantId: true, restaurant: { select: { name: true } } } },
          assignment: { select: { riderId: true, rider: { select: { user: { select: { name: true, phone: true } } } } } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 200
  });

  // Bucket for aggregates.
  const byRestaurantMap = new Map<string, { name: string; rows: any[] }>();
  const byRiderMap = new Map<string, { name: string; phone: string | null; rows: any[] }>();
  for (const r of rows) {
    const rid = r.order?.branch?.restaurantId;
    if (rid) {
      const name = r.order?.branch?.restaurant?.name ?? '(unknown)';
      if (!byRestaurantMap.has(rid)) byRestaurantMap.set(rid, { name, rows: [] });
      byRestaurantMap.get(rid)!.rows.push(r);
    }
    const ridId = r.order?.assignment?.riderId;
    if (ridId) {
      const u = r.order?.assignment?.rider?.user;
      if (!byRiderMap.has(ridId)) byRiderMap.set(ridId, { name: u?.name ?? '(unknown)', phone: u?.phone ?? null, rows: [] });
      byRiderMap.get(ridId)!.rows.push(r);
    }
  }
  const byRestaurant = [...byRestaurantMap.entries()].map(([id, b]) => ({ restaurantId: id, name: b.name, ...summariseRatings(b.rows) }));
  const byRider = [...byRiderMap.entries()].map(([id, b]) => ({ riderId: id, name: b.name, phone: b.phone, ...summariseRatings(b.rows) }));

  // Recent list — full SUPER_ADMIN visibility.
  const recent = rows.map((r: any) => ({
    ...visibleForRole(r, 'SUPER_ADMIN'),
    order: {
      id: r.orderId,
      code: r.order?.code ?? null,
      restaurant: r.order?.branch?.restaurant?.name ?? null,
      rider: r.order?.assignment?.rider?.user?.name ?? null
    }
  }));

  return (
    <div className="p-6 space-y-4">
      <header>
        <h1 className="display text-2xl font-semibold">Feedback</h1>
        <p className="text-sm text-muted-foreground">Platform-wide ratings across all restaurants and riders (last 30 days).</p>
      </header>
      <FeedbackClient
        initial={JSON.parse(JSON.stringify({
          overall: summariseRatings(rows),
          byRestaurant,
          byRider,
          recent
        }))}
      />
    </div>
  );
}
