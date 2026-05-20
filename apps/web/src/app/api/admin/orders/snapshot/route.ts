import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { resolveGroupContext } from '@/server/group-scope';

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

  // For a group parent, span every branch across the group; otherwise keep the
  // single-branch behaviour. Auth is the same currentRestaurant() guard, and
  // resolveGroupContext only widens to children of the active restaurant.
  const group = await resolveGroupContext(restaurant.id);

  const orders = await prisma.order.findMany({
    where: group.isGroup ? { branchId: { in: group.branchIds } } : { branchId: branch.id },
    include: {
      customer: true,
      items: true,
      address: true,
      assignment: { include: { rider: { include: { user: true } } } }
    },
    orderBy: { placedAt: 'desc' },
    take: 100
  });
  // Annotate each order with its source-restaurant label (null when not grouped).
  const annotated = orders.map((o) => ({
    ...o,
    _label: group.labelByBranchId[o.branchId] ?? null
  }));
  return Response.json({
    at: new Date().toISOString(),
    branchId: branch.id,
    isGroup: group.isGroup,
    orders: JSON.parse(JSON.stringify(annotated))
  });
}
