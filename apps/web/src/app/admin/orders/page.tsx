import { prisma } from '@/server/db';
import { requireRestaurant, accessibleOrderScope } from '@/server/tenancy';
import { OrdersBoard } from './orders-board';
import { PauseControl } from './pause-control';
import { isPaused } from '@/server/branch-pause';
import { auth } from '@/server/auth';

export const metadata = { title: 'Admin · Orders' };
// Never cache — every page render must reflect the live database. Without
// force-dynamic, Next.js may serve a cached HTML that pre-dates a just-placed
// order, defeating the SSE + snapshot sync below.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminOrdersPage({ searchParams: _sp }: { searchParams: Promise<{ filter?: string }> }) {
  await _sp; // touched for Next.js dynamic rendering
  await auth();
  await requireRestaurant(); // role/membership gate (throws 404 for non-tenant users)

  // Order monitoring spans EVERY restaurant this account manages — not just the
  // active one — so an order is never invisible because the wrong restaurant is
  // selected. For a single-restaurant operator this is exactly that one branch.
  const scope = await accessibleOrderScope();
  if (!scope) {
    return <div className="p-6">No restaurant for this account.</div>;
  }
  const primaryBranchId = scope.primaryBranchId ?? scope.branchIds[0]!;
  const pause = await isPaused(primaryBranchId);

  const orders = await prisma.order.findMany({
    where: { branchId: { in: scope.branchIds } },
    include: { customer: true, items: true, address: true, assignment: { include: { rider: { include: { user: true } } } } },
    orderBy: { placedAt: 'desc' },
    take: 100
  });
  // Annotate each order with its source restaurant for the board's label/filter.
  const annotated = orders.map((o) => ({
    ...o,
    _label: scope.labelByBranchId[o.branchId] ?? null
  }));

  const restaurantOptions = scope.multi
    ? scope.restaurants.map((r) => ({ id: r.id, name: r.name, isParent: r.id === scope.activeRestaurantId }))
    : [];

  return (
    <div className="p-6 space-y-4">
      <h1 className="display text-2xl font-semibold">Orders</h1>
      <PauseControl
        branchId={primaryBranchId}
        initial={{
          paused: pause.paused,
          reason: pause.reason,
          until: pause.until ? pause.until.toISOString() : undefined,
          indefinite: pause.indefinite
        }}
      />
      <OrdersBoard
        branchId={primaryBranchId}
        channel={`branch:${primaryBranchId}:orders`}
        channels={scope.channels}
        isGroup={scope.multi}
        restaurantOptions={restaurantOptions}
        initial={JSON.parse(JSON.stringify(annotated))}
      />
    </div>
  );
}
