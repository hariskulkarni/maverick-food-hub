/**
 * Tenant guards for the admin menu write routes.
 *
 * A body-supplied branchId / categoryId must belong to the caller's restaurant
 * (and the category to that branch), otherwise one restaurant admin could
 * write into another restaurant's menu. Mismatches are reported as 404 so ids
 * don't leak across tenants.
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

export function notFound(what: string): Response {
  return Response.json({ error: `${what} not found.`, reason: 'not_found' }, { status: 404 });
}

/** The caller's restaurant id, or the Response requireRestaurant() threw. */
export async function callerRestaurantId(): Promise<string | Response> {
  try {
    return (await requireRestaurant()).id;
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function branchOwned(branchId: string, restaurantId: string): Promise<boolean> {
  const b = await prisma.branch.findFirst({ where: { id: branchId, restaurantId }, select: { id: true } });
  return !!b;
}

export async function categoryInBranch(categoryId: string, branchId: string): Promise<boolean> {
  const c = await prisma.category.findFirst({ where: { id: categoryId, branchId }, select: { id: true } });
  return !!c;
}
