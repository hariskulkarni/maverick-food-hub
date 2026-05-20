/**
 * Shared auth + branch-resolution for the menu import/export route handlers.
 *
 * Mirrors the existing admin pattern: `auth()` gates on the ADMIN role,
 * `requireRestaurant()` resolves the caller's restaurant, and the active
 * branch is picked the same way `/admin/menu/page.tsx` does (first active
 * branch by createdAt). On failure it returns a Response to throw/return.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

export type BranchScope = { branchId: string } | { error: Response };

export async function resolveBranchScope(): Promise<BranchScope> {
  const session = await auth();
  if (session?.user.role !== 'ADMIN') {
    return { error: new Response('Forbidden', { status: 403 }) };
  }
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirst({
    where: { restaurantId: restaurant.id, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!branch) {
    return { error: new Response('No active branch for this restaurant', { status: 404 }) };
  }
  return { branchId: branch.id };
}
