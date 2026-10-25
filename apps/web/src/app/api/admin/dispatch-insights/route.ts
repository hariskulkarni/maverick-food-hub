/**
 * GET /api/admin/dispatch-insights?from&to[&restaurantId]
 *
 * The restaurant's own dispatch KPIs (ready-tap rate, prep accuracy, rider
 * wait, food waiting for rider, on-time %). Tenancy: requireManagedRestaurant
 * (super admin may pass restaurantId).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireManagedRestaurant } from '@/server/tenancy';
import { parseOrJsonError } from '@/server/zod-helpers';
import { getDispatchInsights, defaultRange } from '@/server/dispatch/insights';
import { getJitConfig } from '@/server/dispatch/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  restaurantId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const q = parseOrJsonError(Query, Object.fromEntries(req.nextUrl.searchParams));
    if (q instanceof Response) return q;
    const d = defaultRange();
    const cfg = await getJitConfig();
    const data = await getDispatchInsights(
      { from: q.from ?? d.from, to: q.to ?? d.to, restaurantId: restaurant.id },
      { slaMin: cfg.promiseSlaMin, includeRestaurants: false, includeZones: false }
    );
    return Response.json(
      { restaurantId: restaurant.id, range: data.range, summary: data.summary, unassignedOver5MinLive: data.unassignedOver5MinLive, daily: data.daily },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
