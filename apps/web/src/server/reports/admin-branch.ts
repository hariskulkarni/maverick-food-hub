/**
 * Resolve the admin's branch the same way every admin/* endpoint does:
 * pick the oldest active branch of the requireRestaurant() result.
 */

import { prisma } from '../db';
import { requireRestaurant } from '../tenancy';
import { resolveGroupContext } from '../group-scope';

export async function requireAdminBranch() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  return { restaurant, branch };
}

/**
 * Report scope = every branch the active restaurant's GROUP owns (parent +
 * children), matching the group rollup the Reports page charts already show.
 * For a solo restaurant this is just its own branches. Exports were previously
 * scoped to a single (oldest) branch, so multi-branch/group tenants saw CSV/XLSX
 * totals diverge from the on-screen charts — this aligns them.
 */
export async function requireAdminReportScope() {
  const restaurant = await requireRestaurant();
  const group = await resolveGroupContext(restaurant.id);
  let branchIds = group.branchIds;
  if (!branchIds || branchIds.length === 0) {
    const branches = await prisma.branch.findMany({
      where: { restaurantId: restaurant.id },
      select: { id: true }
    });
    branchIds = branches.map((b) => b.id);
  }
  return { restaurant, branchIds };
}
