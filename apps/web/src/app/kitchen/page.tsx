import { prisma } from '@/server/db';
import { requireRestaurant, accessibleOrderScope } from '@/server/tenancy';
import { KitchenBoard } from './kitchen-board';

export const metadata = { title: 'Kitchen' };
// Never cache this page — the order list MUST reflect the live database on
// every server render. Without force-dynamic, Next.js might serve a cached
// HTML response that pre-dates the customer's just-placed order, defeating
// the SSE sync we're hardening below.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function KitchenPage() {
  await requireRestaurant(); // role/membership gate
  // Span every restaurant this account manages so an order is never invisible
  // because the wrong restaurant is active. A single-restaurant kitchen user
  // collapses to exactly their one branch.
  const scope = await accessibleOrderScope();
  if (!scope) return <div className="p-6">No restaurant for this account.</div>;
  // RECEIVED is included so newly-placed customer orders surface in a
  // dedicated "New" column on the kitchen board with an Accept button. The
  // admin's /admin/orders board can still accept them too — both paths route
  // through the same transitionOrder() server logic.
  const orders = await prisma.order.findMany({
    where: { branchId: { in: scope.branchIds }, status: { in: ['RECEIVED', 'ACCEPTED', 'PREPARING', 'READY'] } },
    // Expand each combo so the kitchen sees what's actually being plated. The
    // OrderItem.name is the combo's snapshot name; the constituent menuItem
    // names come from the related Combo.items[].
    include: {
      items: {
        include: {
          combo: { include: { items: { include: { menuItem: true } } } }
        }
      },
      customer: true
    },
    // RECEIVED orders have no `acceptedAt` yet — fall through to placedAt so
    // they sort by arrival time within the New column.
    orderBy: [{ acceptedAt: 'asc' }, { placedAt: 'asc' }]
  });

  // Pre-compute a `comboBreakdown` per OrderItem so the client component can
  // stay dumb — no client-side prisma fetches, no combo definition lookups.
  const decorated = orders.map((o) => ({
    ...o,
    _label: scope.labelByBranchId[o.branchId] ?? null,
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

  return (
    <KitchenBoard
      branchId={scope.primaryBranchId ?? scope.branchIds[0]!}
      channels={scope.channels}
      multi={scope.multi}
      initial={JSON.parse(JSON.stringify(decorated))}
    />
  );
}
