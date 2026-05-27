import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { MenuManager } from './menu-manager';
import { ImportExportPanel } from './import-export-panel';
import { isCategoryAvailableNow } from '@/server/category-availability';
import { NoBranchNotice } from '../no-branch-notice';

/**
 * MenuWorkspace — the full menu management surface (bulk import/export +
 * category & item editor with scheduling and variants/modifiers) for the
 * active restaurant's first active branch.
 *
 * Extracted so it is the SINGLE source of truth shared by both the canonical
 * `/admin/menu` page and the Storefront CMS hub's Menu tab — no duplicated
 * fetch logic, no divergence.
 */
export async function MenuWorkspace() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!branch) return <NoBranchNotice />;
  // Include availability rows so the schedule editor opens pre-populated
  // and the row badge can resolve current status without a follow-up fetch.
  const categories = await prisma.category.findMany({
    where: { branchId: branch.id },
    orderBy: { sortOrder: 'asc' },
    include: { availabilities: true },
  });
  const items = await prisma.menuItem.findMany({ where: { branchId: branch.id }, orderBy: { sortOrder: 'asc' } });

  // Decorate each category with its server-resolved availability snapshot so
  // the badge is correct on first paint. Client never recomputes — it just
  // polls /api/admin/menu/categories/[id]/schedule when the editor saves.
  const decorated = categories.map((c) => ({
    ...c,
    statusNow: isCategoryAvailableNow({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      scheduleEnabled: c.scheduleEnabled,
      availabilities: c.availabilities,
    }),
  }));

  return (
    <>
      <ImportExportPanel />
      <MenuManager
        branchId={branch.id}
        categories={JSON.parse(JSON.stringify(decorated))}
        items={JSON.parse(JSON.stringify(items))}
      />
    </>
  );
}
