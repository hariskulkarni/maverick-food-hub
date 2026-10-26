import { prisma } from '@/server/db';
import { loadAdminBoardOrders } from '@/server/staff-orders';
import { requireRestaurant, accessibleOrderScope } from '@/server/tenancy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admin orders snapshot — returns every active order plus the 100 most
 * recent orders for the signed-in admin's restaurants, in the same shape the SSR page loads.
 *
 * Purpose: the admin orders board polls this every 15s and on tab-visible
 * to defend against SSE silently dropping (laptop sleep, nginx restart,
 * mobile data tower hand-off). The SSE path stays the fast path; this is
 * the safety net that guarantees no order is invisible for more than ~15s.
 */
export async function GET() {
  await requireRestaurant(); // role/membership gate
  // Span EVERY restaurant this account manages — same scope the SSR page uses —
  // so the poll surfaces orders from all of them, not just the active one.
  const scope = await accessibleOrderScope();
  if (!scope) return new Response('No restaurant for this user', { status: 404 });

  // Same shape as the SSR page: active orders + latest 100, no full User rows.
  const orders = await loadAdminBoardOrders(prisma, scope.branchIds);
  const annotated = orders.map((o) => ({
    ...o,
    _label: scope.labelByBranchId[o.branchId] ?? null
  }));
  return Response.json(
    {
      at: new Date().toISOString(),
      branchId: scope.primaryBranchId,
      isGroup: scope.multi,
      orders: JSON.parse(JSON.stringify(annotated))
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
