/**
 * Shared auth + ownership helpers for the variant & modifier-group route
 * handlers. Mirrors the existing admin menu pattern: `auth()` gates on the
 * ADMIN role, `requireRestaurant()` resolves the caller's restaurant, and we
 * verify the target MenuItem (or a child variant/group/option) belongs to a
 * branch under that restaurant before any read/mutation runs.
 *
 * Each guard returns either the resolved id(s) or `{ error: Response }` for
 * the caller to return directly.
 */
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';
import { requireRestaurantAdminApi } from '@/server/api-auth';

type Guard<T> = T | { error: Response };

/** Resolve the caller's restaurant after an ADMIN-role check. */
async function requireAdminRestaurant(): Promise<Guard<{ restaurantId: string }>> {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return { error: gate };
  try {
    const restaurant = await requireRestaurant();
    return { restaurantId: restaurant.id };
  } catch (e) {
    if (e instanceof Response) return { error: e };
    throw e;
  }
}

/** Confirm `itemId` is a MenuItem under the caller's restaurant. */
export async function requireOwnedItem(itemId: string): Promise<Guard<{ itemId: string; restaurantId: string }>> {
  const r = await requireAdminRestaurant();
  if ('error' in r) return r;
  const item = await prisma.menuItem.findFirst({
    where: { id: itemId, branch: { restaurantId: r.restaurantId } },
    select: { id: true },
  });
  if (!item) return { error: new Response('Not found', { status: 404 }) };
  return { itemId: item.id, restaurantId: r.restaurantId };
}

/** Confirm `variantId` belongs to `itemId`, which is under the caller's restaurant. */
export async function requireOwnedVariant(itemId: string, variantId: string): Promise<Guard<{ variantId: string }>> {
  const owned = await requireOwnedItem(itemId);
  if ('error' in owned) return owned;
  const variant = await prisma.menuItemVariant.findFirst({
    where: { id: variantId, menuItemId: owned.itemId },
    select: { id: true },
  });
  if (!variant) return { error: new Response('Not found', { status: 404 }) };
  return { variantId: variant.id };
}

/** Confirm `groupId` belongs to `itemId`, which is under the caller's restaurant. */
export async function requireOwnedGroup(itemId: string, groupId: string): Promise<Guard<{ groupId: string }>> {
  const owned = await requireOwnedItem(itemId);
  if ('error' in owned) return owned;
  const group = await prisma.modifierGroup.findFirst({
    where: { id: groupId, menuItemId: owned.itemId },
    select: { id: true },
  });
  if (!group) return { error: new Response('Not found', { status: 404 }) };
  return { groupId: group.id };
}

/** Confirm `optionId` belongs to `groupId`, which belongs to `itemId` under the caller's restaurant. */
export async function requireOwnedOption(itemId: string, groupId: string, optionId: string): Promise<Guard<{ optionId: string }>> {
  const owned = await requireOwnedGroup(itemId, groupId);
  if ('error' in owned) return owned;
  const option = await prisma.modifierOption.findFirst({
    where: { id: optionId, modifierGroupId: owned.groupId },
    select: { id: true },
  });
  if (!option) return { error: new Response('Not found', { status: 404 }) };
  return { optionId: option.id };
}

// ── Decimal → Number serializers ──────────────────────────────────────────

type VariantRow = {
  id: string; menuItemId: string; name: string; price: unknown;
  isDefault: boolean; isAvailable: boolean; sortOrder: number;
};
export function serializeVariant(v: VariantRow) {
  return {
    id: v.id,
    menuItemId: v.menuItemId,
    name: v.name,
    price: Number(v.price),
    isDefault: v.isDefault,
    isAvailable: v.isAvailable,
    sortOrder: v.sortOrder,
  };
}

type OptionRow = {
  id: string; modifierGroupId: string; name: string; priceDelta: unknown;
  isDefault: boolean; isAvailable: boolean; sortOrder: number;
};
export function serializeOption(o: OptionRow) {
  return {
    id: o.id,
    modifierGroupId: o.modifierGroupId,
    name: o.name,
    priceDelta: Number(o.priceDelta),
    isDefault: o.isDefault,
    isAvailable: o.isAvailable,
    sortOrder: o.sortOrder,
  };
}

type GroupRow = {
  id: string; menuItemId: string; name: string; minSelect: number;
  maxSelect: number; required: boolean; sortOrder: number; options?: OptionRow[];
};
export function serializeGroup(g: GroupRow) {
  return {
    id: g.id,
    menuItemId: g.menuItemId,
    name: g.name,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    required: g.required,
    sortOrder: g.sortOrder,
    options: (g.options ?? []).map(serializeOption),
  };
}
