import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { MenuManager } from './menu-manager';
import { isCategoryAvailableNow } from '@/server/category-availability';

export const metadata = { title: 'Admin · Menu' };

export default async function AdminMenuPage() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({ where: { restaurantId: restaurant.id, isActive: true }, orderBy: { createdAt: 'asc' } });
  // Include availability rows so the schedule editor opens pre-populated
  // and the row badge can resolve current status without a follow-up fetch.
  const categories = await prisma.category.findMany({
    where: { branchId: branch.id },
    orderBy: { sortOrder: 'asc' },
    include: { availabilities: true }
  });
  const items = await prisma.menuItem.findMany({ where: { branchId: branch.id }, orderBy: { sortOrder: 'asc' } });

  // Decorate each category with its server-resolved availability snapshot so
  // the badge is correct on first paint. Client never recomputes — it just
  // polls /api/admin/menu/categories/[id]/schedule when the editor saves.
  const decorated = categories.map((c) => ({
    ...c,
    statusNow: isCategoryAvailableNow({
      id: c.id, name: c.name,
      isActive: c.isActive,
      scheduleEnabled: c.scheduleEnabled,
      availabilities: c.availabilities
    })
  }));

  return (
    <div className="p-6">
      <h1 className="display text-2xl font-semibold mb-4">Menu</h1>
      <MenuManager
        branchId={branch.id}
        categories={JSON.parse(JSON.stringify(decorated))}
        items={JSON.parse(JSON.stringify(items))}
      />
    </div>
  );
}
