/**
 * Shared helpers for the restaurant-admin reservations API routes.
 * (route.ts files may only export HTTP handlers — reusables live here.)
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

/** The admin's primary (oldest) branch. Reservations are scoped to this branch. */
export async function primaryBranchForCurrentRestaurant() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' }
  });
  return { restaurant, branch };
}

export function serialize<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
