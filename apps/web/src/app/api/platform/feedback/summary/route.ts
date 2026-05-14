/**
 * GET /api/platform/feedback/summary
 *
 * Platform-wide feedback summary, aggregated by restaurant and by rider.
 *
 *   byRestaurant[]: { restaurantId, name, ...summary }
 *   byRider[]:      { riderId, name, phone, ...summary }
 *   overall:        single summary across all rows
 *
 * Default range is the last 30 days; clients can pass `from`/`to` to widen.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { summariseRatings } from '@/server/feedback';
import { prisma } from '@/server/db';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const sp = req.nextUrl.searchParams;
  const to = sp.get('to') ? new Date(sp.get('to') as string) : new Date();
  const from = sp.get('from') ? new Date(sp.get('from') as string) : new Date(to.getTime() - 30 * 86_400_000);

  const rows = await (prisma as any).orderFeedback.findMany({
    where: { createdAt: { gte: from, lt: to } },
    include: {
      order: {
        select: {
          branch: { select: { restaurantId: true, restaurant: { select: { name: true } } } },
          assignment: { select: { riderId: true, rider: { select: { user: { select: { name: true, phone: true } } } } } }
        }
      }
    }
  });

  // Bucket by restaurantId + by riderId, then summarise inside each bucket.
  const byRestaurantBuckets = new Map<string, { name: string; rows: any[] }>();
  const byRiderBuckets = new Map<string, { name: string; phone: string | null; rows: any[] }>();

  for (const r of rows) {
    const rid = r.order?.branch?.restaurantId;
    const rname = r.order?.branch?.restaurant?.name ?? '(unknown)';
    if (rid) {
      if (!byRestaurantBuckets.has(rid)) byRestaurantBuckets.set(rid, { name: rname, rows: [] });
      byRestaurantBuckets.get(rid)!.rows.push(r);
    }
    const riderId = r.order?.assignment?.riderId;
    if (riderId) {
      const rd = r.order?.assignment?.rider?.user;
      if (!byRiderBuckets.has(riderId)) byRiderBuckets.set(riderId, { name: rd?.name ?? '(unknown)', phone: rd?.phone ?? null, rows: [] });
      byRiderBuckets.get(riderId)!.rows.push(r);
    }
  }

  const byRestaurant = [...byRestaurantBuckets.entries()].map(([restaurantId, b]) => ({
    restaurantId,
    name: b.name,
    ...summariseRatings(b.rows)
  }));
  const byRider = [...byRiderBuckets.entries()].map(([riderId, b]) => ({
    riderId,
    name: b.name,
    phone: b.phone,
    ...summariseRatings(b.rows)
  }));

  return Response.json({
    from: from.toISOString(),
    to: to.toISOString(),
    overall: summariseRatings(rows),
    byRestaurant,
    byRider
  });
}
