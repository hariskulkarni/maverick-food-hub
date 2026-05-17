import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admin orders snapshot — returns the 100 most recent orders for the
 * signed-in admin's restaurant, in the same shape the SSR page loads.
 *
 * Purpose: the admin orders board polls this every 15s and on tab-visible
 * to defend against SSE silently dropping (laptop sleep, nginx restart,
 * mobile data tower hand-off). The SSE path stays the fast path; this is
 * the safety net that guarantees no order is invisible for more than ~15s.
 */
export async function GET() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' }
  });
  const orders = await prisma.order.findMany({
    where: { branchId: branch.id },
    include: {
      customer: true,
      items: true,
      address: true,
      assignment: { include: { rider: { include: { user: true } } } }
    },
    orderBy: { placedAt: 'desc' },
    take: 100
  });
  return Response.json({
    at: new Date().toISOString(),
    branchId: branch.id,
    orders: JSON.parse(JSON.stringify(orders))
  });
}
