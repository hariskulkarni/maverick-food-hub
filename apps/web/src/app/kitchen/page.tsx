import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { KitchenBoard } from './kitchen-board';

export const metadata = { title: 'Kitchen' };

export default async function KitchenPage() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id, isActive: true }, orderBy: { createdAt: 'asc' } });
  const orders = await prisma.order.findMany({
    where: { branchId: branch.id, status: { in: ['ACCEPTED', 'PREPARING', 'READY'] } },
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
    orderBy: { acceptedAt: 'asc' }
  });

  // Pre-compute a `comboBreakdown` per OrderItem so the client component can
  // stay dumb — no client-side prisma fetches, no combo definition lookups.
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

  return <KitchenBoard branchId={branch.id} initial={JSON.parse(JSON.stringify(decorated))} />;
}
