/**
 * PATCH /api/admin/storefront/categories — reorder + show/hide menu categories
 * for the storefront. Body: { items: [{ id, sortOrder, isActive }] }. Scoped to
 * the admin's restaurant branches so one tenant can't touch another's menu.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

export const runtime = 'nodejs';

const Body = z.object({
  items: z.array(z.object({
    id: z.string(),
    sortOrder: z.number().int().min(0).max(9999),
    isActive: z.boolean(),
  })).max(500),
});

export async function PATCH(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const { items } = Body.parse(await req.json());

  // Resolve the branches this restaurant owns and validate every category id
  // belongs to one of them (tenant isolation).
  const branches = await prisma.branch.findMany({ where: { restaurantId: restaurant.id }, select: { id: true } });
  const branchIds = new Set(branches.map((b) => b.id));
  const cats = await prisma.category.findMany({
    where: { id: { in: items.map((i) => i.id) } },
    select: { id: true, branchId: true },
  });
  const owned = new Set(cats.filter((c) => branchIds.has(c.branchId)).map((c) => c.id));

  await prisma.$transaction(
    items
      .filter((i) => owned.has(i.id))
      .map((i) => prisma.category.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder, isActive: i.isActive } })),
  );
  return Response.json({ ok: true, updated: [...owned].length });
}
