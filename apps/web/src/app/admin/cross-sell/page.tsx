import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { CrossSellClient } from './cross-sell-client';

export const metadata = { title: 'Admin · Cross-sell' };
export const dynamic = 'force-dynamic';

export default async function CrossSellPage() {
  const restaurant = await requireRestaurant();
  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isActive: true }
  });
  const branchIds = branches.map((b) => b.id);

  const menuItems = await prisma.menuItem.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: [{ branchId: 'asc' }, { sortOrder: 'asc' }],
    select: { id: true, name: true, branchId: true, categoryId: true, price: true, isAvailable: true }
  });

  const itemIds = menuItems.map((m) => m.id);
  const crossSells = await (prisma as any).crossSell.findMany({
    where: { parentItemId: { in: itemIds } },
    orderBy: [{ parentItemId: 'asc' }, { sortOrder: 'asc' }]
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <header>
        <h1 className="display text-3xl font-semibold">Cross-sell</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Curate "Frequently ordered together" suggestions for {restaurant.name}. Set a parent item, pick suggested items, and choose where they show up — product page, cart, or both.
        </p>
      </header>
      <CrossSellClient
        crossSells={JSON.parse(JSON.stringify(crossSells))}
        menuItems={JSON.parse(JSON.stringify(menuItems))}
        branches={branches}
      />
    </div>
  );
}
