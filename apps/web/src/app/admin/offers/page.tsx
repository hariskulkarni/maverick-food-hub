import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { OffersClient } from './offers-client';

export const metadata = { title: 'Admin · Offers' };
export const dynamic = 'force-dynamic';

export default async function OffersPage() {
  const restaurant = await requireRestaurant();

  const branches = await prisma.branch.findMany({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, isActive: true }
  });
  const branchIds = branches.map((b) => b.id);

  const categories = await prisma.category.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: [{ branchId: 'asc' }, { sortOrder: 'asc' }],
    select: { id: true, name: true, branchId: true }
  });

  const menuItems = await prisma.menuItem.findMany({
    where: { branchId: { in: branchIds } },
    orderBy: [{ branchId: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      name: true,
      branchId: true,
      categoryId: true,
      price: true,
      isAvailable: true
    }
  });

  // Pull all offers scoped to this restaurant (or its branches), including scopes
  // and a redemption count so the table can render "X/Y used" without a follow-up.
  const offers = await (prisma as any).offer.findMany({
    where: {
      OR: [
        { restaurantId: restaurant.id },
        { branchId: { in: branchIds } }
      ]
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    include: {
      appliesToCategories: { select: { categoryId: true } },
      appliesToItems: { select: { menuItemId: true } },
      _count: { select: { redemptions: true } }
    }
  });

  // First-of-month boundary so we can show "redemptions this month".
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const redemptionsThisMonth = await (prisma as any).offerRedemption.count({
    where: {
      offer: {
        OR: [
          { restaurantId: restaurant.id },
          { branchId: { in: branchIds } }
        ]
      },
      createdAt: { gte: monthStart }
    }
  });

  // Top-performer by usedCount for the KPI tile.
  const topPerformer = offers
    .slice()
    .sort((a: any, b: any) => (b.usedCount ?? 0) - (a.usedCount ?? 0))[0] ?? null;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <header>
        <h1 className="display text-3xl font-semibold">Offers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Build, target and track promotions for {restaurant.name}. Offers stack with the legacy coupon engine — the pricing layer always picks the best combination.
        </p>
      </header>
      <OffersClient
        offers={JSON.parse(JSON.stringify(offers))}
        branches={branches}
        categories={categories}
        menuItems={JSON.parse(JSON.stringify(menuItems))}
        restaurantId={restaurant.id}
        kpis={{
          redemptionsThisMonth,
          topPerformerName: topPerformer?.name ?? null,
          topPerformerUsedCount: topPerformer?.usedCount ?? 0
        }}
      />
    </div>
  );
}
