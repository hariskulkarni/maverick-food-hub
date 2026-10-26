import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { MenuManager } from './menu-manager';
import { ImportExportPanel } from './import-export-panel';
import { isCategoryAvailableNow } from '@/server/category-availability';
import { NoBranchNotice } from '../no-branch-notice';
import { STAFF_BRANCH_ORDER } from '@/server/branch-pause';
import { menuMasterState } from '@/server/novaryq/menu-master';

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
    where: { restaurantId: restaurant.id },
    orderBy: STAFF_BRANCH_ORDER,
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

  // "POS: Novaryq": linked items are read-only here; spreadsheet import is replaced by the Novaryq import.
  const master = await menuMasterState(restaurant.id);
  const lockedIds = master.on
    ? (await prisma.novaryqItemLink.findMany({ where: { restaurantId: restaurant.id, menuItem: { branchId: branch.id } }, select: { menuItemId: true } })).map((l) => l.menuItemId)
    : [];

  return (
    <>
      {master.on ? (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <b>POS: Novaryq.</b> Your menu is managed in Novaryq: names, prices and availability of the {lockedIds.length} linked items sync here automatically.
          You can still edit photos, descriptions, sizes and add-ons, and Flavrly-only items.{' '}
          <a href="/admin/integrations" className="text-primary underline">POS integration</a>
          {master.manageUrl && <> · <a href={master.manageUrl} target="_blank" rel="noreferrer noopener" className="text-primary underline">Manage in Novaryq</a></>}
        </div>
      ) : (
        <ImportExportPanel />
      )}
      <MenuManager
        branchId={branch.id}
        categories={JSON.parse(JSON.stringify(decorated))}
        items={JSON.parse(JSON.stringify(items))}
        novaryq={master.on ? { lockedIds, manageUrl: master.manageUrl, allowPriceOverride: master.allowPriceOverride } : undefined}
      />
    </>
  );
}
