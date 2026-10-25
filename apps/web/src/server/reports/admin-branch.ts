/**
 * Resolve the admin's branch the same way every admin/* endpoint does:
 * pick the restaurant's primary branch (active first, then oldest; a paused
 * branch still counts) of the requireRestaurant() result.
 */

import { prisma } from '../db';
import { requireRestaurant, requireTenantAdmin } from '../tenancy';
import { resolveGroupContext } from '../group-scope';
import { STAFF_BRANCH_ORDER } from '@/server/branch-pause';

export async function requireAdminBranch() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id },
    orderBy: STAFF_BRANCH_ORDER
  });
  return { restaurant, branch };
}

/**
 * Report scope = every branch the active restaurant's GROUP owns (parent +
 * children), matching the group rollup the Reports page charts already show.
 * For a solo restaurant this is just its own branches. Exports were previously
 * scoped to a single (oldest) branch, so multi-branch/group tenants saw CSV/XLSX
 * totals diverge from the on-screen charts — this aligns them.
 * Throws a 401/403/404 Response unless the caller ADMINs the active restaurant.
 */
export async function requireAdminReportScope() {
  // Reports + exports carry revenue and customer PII → tenant ADMIN only (P1-4).
  const restaurant = await requireTenantAdmin();
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
