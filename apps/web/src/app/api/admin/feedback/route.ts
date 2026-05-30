/**
 * GET /api/admin/feedback
 *
 * Restaurant-scoped feedback list for the admin dashboard.
 *
 * Query params:
 *   from?   ISO timestamp — start of window (inclusive)
 *   to?     ISO timestamp — end of window (exclusive)
 *   lowOnly boolean ("1"/"true") — restrict to feedback with any rating ≤ 2
 *
 * Every row is projected through `visibleForRole(_, 'ADMIN')` before
 * returning — the delivery rating is stripped, only food-related issue tags
 * survive. Sort is newest-first, capped at 100 rows.
 */
import { NextRequest } from 'next/server';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { loadRestaurantFeedback, visibleForRole, summariseRatings } from '@/server/feedback';

export async function GET(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();
  const sp = req.nextUrl.searchParams;

  const from = sp.get('from') ? new Date(sp.get('from') as string) : undefined;
  const to = sp.get('to') ? new Date(sp.get('to') as string) : undefined;
  const lowRaw = sp.get('lowOnly');
  const lowOnly = lowRaw === '1' || lowRaw === 'true';

  const { rows } = await loadRestaurantFeedback(restaurant.id, { from, to, lowOnly });
  const limited = rows.slice(0, 100);

  // Project each row through the ADMIN visibility rules, but keep the order
  // metadata alongside so the dashboard can render the "Open order →" link.
  const projected = limited.map((r: any) => ({
    ...visibleForRole(r, 'ADMIN'),
    order: {
      id: r.orderId,
      code: r.order?.code ?? null,
      total: r.order?.total ?? null
    }
  }));

  return Response.json({
    rows: projected,
    summary: summariseRatings(limited)
  });
}
