/**
 * Shared helpers for the restaurant-admin freebie-rule management API routes.
 * (route.ts files may only export HTTP handlers, so anything reusable lives here.)
 *
 * Freebie rules are scoped to the admin's primary branch — mirroring the
 * dine-in tables feature. The gift item (menuItemId) must belong to that same
 * branch, so callers validate it with `menuItemInBranch` before create/update.
 * Decimal columns (minOrderAmount) are converted to plain numbers before they
 * cross the JSON boundary to the client.
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

/** The admin's primary (oldest) branch. Freebie rules are scoped to this branch. */
export async function primaryBranchForCurrentRestaurant() {
  const restaurant = await requireRestaurant();
  const branch = await prisma.branch.findFirstOrThrow({
    where: { restaurantId: restaurant.id },
    orderBy: { createdAt: 'asc' }
  });
  return { restaurant, branch };
}

/** True when the menu item exists and belongs to the given branch. */
export async function menuItemInBranch(menuItemId: string, branchId: string): Promise<boolean> {
  const item = await prisma.menuItem.findFirst({
    where: { id: menuItemId, branchId },
    select: { id: true }
  });
  return !!item;
}

export interface SerializedFreebieRule {
  id: string;
  branchId: string;
  menuItemId: string;
  itemName: string;
  name: string;
  minOrderAmount: number;
  stock: number;
  totalGranted: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Serialize a freebie-rule row (with `menuItem` relation) for the client. */
export function serializeFreebieRule(r: {
  id: string;
  branchId: string;
  menuItemId: string;
  name: string;
  minOrderAmount: { toString(): string };
  stock: number;
  totalGranted: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  menuItem?: { name: string } | null;
}): SerializedFreebieRule {
  return {
    id: r.id,
    branchId: r.branchId,
    menuItemId: r.menuItemId,
    itemName: r.menuItem?.name ?? '',
    name: r.name,
    minOrderAmount: Number(r.minOrderAmount),
    stock: r.stock,
    totalGranted: r.totalGranted,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString()
  };
}
