import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { bus } from '@/server/realtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Real-time sync diagnostic.
 *
 * Pinpoints exactly which link in the chain is broken when "orders aren't
 * syncing". Hit /api/admin/_diag/sync from the admin or kitchen tab to see:
 *
 *   - Who you're logged in as + which restaurant + which branch
 *   - The 10 most-recent orders for THIS branch (oldest→newest), so you can
 *     confirm whether the order even reached the database
 *   - The number of open SSE subscribers on this branch's channel — this is
 *     the smoking gun for tab-not-connected vs. branch-mismatch problems
 *   - The current process ID + uptime so you can correlate against pm2 logs
 *
 * Restricted to ADMIN / SUPER_ADMIN / KITCHEN — anyone with shoulder-surfing
 * access already sees orders, so this exposes no new data.
 */
export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (!['ADMIN', 'SUPER_ADMIN', 'KITCHEN'].includes(role || '')) {
    return new Response('Forbidden', { status: 403 });
  }

  let restaurantInfo: { id: string; name: string; slug: string } | null = null;
  let branchInfo: { id: string; name: string; city: string } | null = null;
  let channelName: string | null = null;
  let listenerCount: number = 0;
  let recentOrders: Array<{ id: string; code: string; status: string; placedAt: string; customer: string }> = [];
  let error: string | null = null;

  try {
    const restaurant = await requireRestaurant();
    restaurantInfo = { id: restaurant.id, name: restaurant.name, slug: restaurant.slug };

    const branch = await prisma.branch.findFirst({
      where: { restaurantId: restaurant.id },
      orderBy: { createdAt: 'asc' }
    });
    if (branch) {
      branchInfo = { id: branch.id, name: branch.name, city: branch.city };
      channelName = `branch:${branch.id}:orders`;
      listenerCount = bus.listenerCount(channelName);

      const orders = await prisma.order.findMany({
        where: { branchId: branch.id },
        include: { customer: true },
        orderBy: { placedAt: 'desc' },
        take: 10
      });
      recentOrders = orders.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        placedAt: o.placedAt.toISOString(),
        customer: o.customer.name ?? o.customer.email ?? '—'
      }));
    }
  } catch (e) {
    error = (e as Error).message;
  }

  return Response.json({
    at: new Date().toISOString(),
    serverPid: process.pid,
    serverUptimeSec: Math.floor(process.uptime()),
    user: {
      id: session?.user?.id ?? null,
      email: session?.user?.email ?? null,
      role: role ?? null
    },
    restaurant: restaurantInfo,
    branch: branchInfo,
    sse: {
      channel: channelName,
      // listenerCount is the number of OPEN SSE connections to this channel
      // ON THIS NODE PROCESS. If you have admin + kitchen tabs open and this
      // is 0, the tabs are NOT connected — nginx is blocking, the tabs are
      // sleeping, or you're logged into a different restaurant than the one
      // the order was placed at.
      openSubscribers: listenerCount,
      hint: listenerCount === 0
        ? 'No tabs subscribed to this channel right now. Check: (1) is your tab open and focused? (2) are you logged into the same restaurant the order was placed at? (3) is nginx /api/events config correct?'
        : `${listenerCount} tab(s) connected. Real-time delivery should work.`
    },
    recentOrders,
    diagnosticHints: {
      orderInDb: recentOrders.length > 0
        ? `Newest order: ${recentOrders[0].code} (${recentOrders[0].status}) placed ${recentOrders[0].placedAt}. If you just placed an order and don't see it here, the placeOrder API call FAILED — check pm2 logs and the browser network tab.`
        : 'No orders in this branch yet. Place a test order then refresh this endpoint.',
      tenantMatch: restaurantInfo
        ? `You are scoped to restaurant "${restaurantInfo.name}" (slug: ${restaurantInfo.slug}). Orders placed at any OTHER restaurant will not appear in your admin/kitchen view.`
        : 'No restaurant scope — you may not be properly logged in as an admin/kitchen user for any tenant.'
    },
    error
  });
}
