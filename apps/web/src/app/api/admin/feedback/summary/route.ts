/**
 * GET /api/admin/feedback/summary
 *
 * Restaurant-scoped rating summary block: averages, low-rating counts,
 * and top issue tags for a given date range. Default last 30 days.
 *
 * Query params:
 *   from? ISO timestamp
 *   to?   ISO timestamp
 */
import { NextRequest } from 'next/server';
import { requireRestaurant } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { loadRestaurantFeedback } from '@/server/feedback';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const restaurant = await requireRestaurant();
  const sp = req.nextUrl.searchParams;

  const to = sp.get('to') ? new Date(sp.get('to') as string) : new Date();
  const from = sp.get('from') ? new Date(sp.get('from') as string) : new Date(to.getTime() - 30 * 86_400_000);

  const { summary } = await loadRestaurantFeedback(restaurant.id, { from, to });

  // ADMIN doesn't see delivery rating averages — strip those before sending.
  // (The summary aggregates raw rows; we redact at the projection step.)
  const { avgDelivery, lowDeliveryCount, ...adminSummary } = summary;

  return Response.json({
    from: from.toISOString(),
    to: to.toISOString(),
    summary: adminSummary
  });
}
