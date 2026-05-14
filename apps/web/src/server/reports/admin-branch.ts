/**
 * Resolve the admin's branch the same way every admin/* endpoint does:
 * pick the oldest active branch of the requireRestaurant() result.
 */

import { prisma } from '../db';
import { requireRestaurant } from '../tenancy';

export async function requireAdminBranch() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' }
  });
  return { restaurant, branch };
}
