import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Kitchen snapshot — returns every active order for the signed-in kitchen
 * user's restaurant, shaped exactly like the server-page initial load.
 *
 * Purpose: the kitchen board hits this every 15s and on tab-visible to
 * defend against SSE silently dropping (laptop sleep, nginx restart, flaky
 * mobile data tower). The SSE path is still the fast path; this is the
 * safety net that guarantees no order is invisible for more than ~15s
 * regardless of what fails between database and browser.
 *
 * Auth: scoped by `requireRestaurant()` — kitchen + admin roles already
 * pass; the resolver throws on anonymous / wrong-role.
 */
export async function GET() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  const orders = await prisma.order.findMany({
    where: {
      branchId: branch.id,
      status: { in: ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'] }
    },
    include: {
      items: {
        include: {
          combo: { include: { items: { include: { menuItem: true } } } }
        }
      },
      customer: true
    },
    orderBy: [{ acceptedAt: 'asc' }, { placedAt: 'asc' }]
  });
  // Same combo expansion the SSR path does — keeps the shape identical so
  // the client can swap snapshot for SSE-driven state without juggling
  // two formats.
  const decorated = orders.map((o) => ({
    ...o,
    items: o.items.map((i: any) => ({
      ...i,
      comboBreakdown: i.combo
        ? (i.combo.items as any[]).map((ci) => ({
            name: ci.menuItem?.name ?? 'Unknown item',
            qty: ci.quantity
          }))
        : null
    }))
  }));
  return Response.json({
    at: new Date().toISOString(),
    branchId: branch.id,
    orders: JSON.parse(JSON.stringify(decorated))
  });
}
