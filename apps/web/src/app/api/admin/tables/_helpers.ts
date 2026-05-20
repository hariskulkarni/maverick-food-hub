/**
 * Shared helpers for the restaurant-admin table-management API routes.
 * (route.ts files may only export HTTP handlers, so anything reusable lives here.)
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

/** The admin's primary (oldest) branch. Tables are scoped to this branch. */
export async function primaryBranchForCurrentRestaurant() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' }
  });
  return { restaurant, branch };
}

export function serializeTable<T>(t: T): any {
  return JSON.parse(JSON.stringify(t));
}
