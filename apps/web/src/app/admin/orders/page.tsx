import { prisma } from '@/server/db';
import { loadAdminBoardOrders } from '@/server/staff-orders';
import { requireRestaurant, accessibleOrderScope } from '@/server/tenancy';
import { OrdersBoard } from './orders-board';
import { PauseControl } from './pause-control';
import { isPaused } from '@/server/branch-pause';
import { auth } from '@/server/auth';
import { LogoMark } from '@/components/brand/logo';
import { HelpButton } from '@/components/help/help-button';

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
    return <div className="p-4 sm:p-6">No restaurant for this account.</div>;
  }
  const primaryBranchId = scope.primaryBranchId ?? scope.branchIds[0]!;
  const pause = await isPaused(primaryBranchId);

  // P2-15: every ACTIVE order + the latest 100 of any status (a busy day can't
  // push a live order off the board). P2-13: customer/rider as {id,name,phone}.
  const orders = await loadAdminBoardOrders(prisma, scope.branchIds);
  // Annotate each order with its source restaurant for the board's label/filter.
  const annotated = orders.map((o) => ({
    ...o,
    _label: scope.labelByBranchId[o.branchId] ?? null
  }));

  const restaurantOptions = scope.multi
    ? scope.restaurants.map((r) => ({ id: r.id, name: r.name, isParent: r.id === scope.activeRestaurantId }))
    : [];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3">
        <LogoMark className="h-9 w-9 shrink-0" />
        <h1 className="display text-2xl font-semibold text-gradient-brand">Orders</h1>
        <HelpButton appArea="admin.orders" className="ml-auto" />
      </div>
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
        channel={scope.groupChannel}
        isGroup={scope.multi}
        restaurantOptions={restaurantOptions}
        initial={JSON.parse(JSON.stringify(annotated))}
      />
    </div>
  );
}
