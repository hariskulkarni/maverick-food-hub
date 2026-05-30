/**
 * GET /api/admin/orders/[id]/feedback
 *
 * Returns the customer feedback for a single order, projected through
 * `visibleForRole(_, 'ADMIN')`. The admin sees the food rating, overall
 * rating, comment, food-related tags, and image — but NEVER the delivery
 * rating (that's the rider/super-admin's domain). 404s if the order isn't
 * in this admin's restaurant, even if the order exists in another tenant.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { findFeedbackByOrder, summariseRatings, visibleForRole } from '@/server/feedback';

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const restaurant = await requireRestaurant();
  const { id } = await params;

  // Tenant gate: the order must belong to a branch of this restaurant.
  const order = await prisma.order.findFirst({
    where: { id, branch: { restaurantId: restaurant.id } },
    select: { id: true }
  });
  if (!order) return Response.json({ error: 'Order not found', reason: 'not_found' }, { status: 404 });

  const feedback = await findFeedbackByOrder(id);
  if (!feedback) return Response.json({ feedback: null, summary: null });

  return Response.json({
    feedback: visibleForRole(feedback as any, 'ADMIN'),
    summary: summariseRatings([feedback as any])
  });
}
