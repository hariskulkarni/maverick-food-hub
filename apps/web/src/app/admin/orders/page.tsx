import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
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
  const session = await auth();
  const restaurant = await requireRestaurant();
  // The branch may be paused (isActive=false). Don't filter on isActive here —
  // we still want the admin to see the orders board for a paused branch so they
  // can resume it. Fall back to any branch for this restaurant.
  const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id }, orderBy: { createdAt: 'asc' } });
  const pause = await isPaused(branch.id);
  const orders = await prisma.order.findMany({
    where: { branchId: branch.id },
    include: { customer: true, items: true, address: true, assignment: { include: { rider: { include: { user: true } } } } },
    orderBy: { placedAt: 'desc' },
    take: 100
  });
  return (
    <div className="p-6 space-y-4">
      <h1 className="display text-2xl font-semibold">Orders</h1>
      <PauseControl
        branchId={branch.id}
        initial={{
          paused: pause.paused,
          reason: pause.reason,
          until: pause.until ? pause.until.toISOString() : undefined,
          indefinite: pause.indefinite
        }}
      />
      <OrdersBoard branchId={branch.id} initial={JSON.parse(JSON.stringify(orders))} />
    </div>
  );
}
