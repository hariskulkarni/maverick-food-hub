import { NextRequest } from 'next/server';
import { requireManagedRestaurant } from '@/server/tenancy';
import { getCachedInsights, refreshInsights } from '@/server/reviews/insights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cached per-restaurant insights (recomputed by the sweep); ?refresh=1 recomputes now. */
export async function GET(req: NextRequest) {
  try {
    const restaurant = await requireManagedRestaurant(req.nextUrl.searchParams.get('restaurantId'));
    const cached = req.nextUrl.searchParams.get('refresh') === '1' ? null : await getCachedInsights(restaurant.id);
    if (cached) return Response.json({ ...cached.data, computedAt: cached.computedAt });
    const data = await refreshInsights(restaurant.id);
    return Response.json({ ...data, computedAt: new Date() });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
