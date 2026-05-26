/**
 * Storefront CMS — per-item ordering & featured flag.
 *
 * GET  ?categoryId=…  → items in that category (id, name, sortOrder, available, featured)
 * PATCH { items:[{id, sortOrder, isFeatured}] } → persist order + featured.
 *
 * "Featured" maps to MenuItem.isRecommended (the storefront's highlight flag).
 * Everything is scoped to the admin's restaurant branches for tenant isolation.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireRestaurant } from '@/server/tenancy';

export const runtime = 'nodejs';

async function ownedBranchIds(restaurantId: string) {
  const b = await prisma.branch.findMany({ where: { restaurantId }, select: { id: true } });
  return new Set(b.map((x) => x.id));
}

export async function GET(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const categoryId = new URL(req.url).searchParams.get('categoryId') ?? '';
  if (!categoryId) return Response.json({ ok: false, message: 'categoryId required' }, { status: 400 });
  const branchIds = await ownedBranchIds(restaurant.id);
  const cat = await prisma.category.findUnique({ where: { id: categoryId }, select: { branchId: true } });
  if (!cat || !branchIds.has(cat.branchId)) return Response.json({ ok: false, message: 'Not found' }, { status: 404 });
  const items = await prisma.menuItem.findMany({
    where: { categoryId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, sortOrder: true, isAvailable: true, isRecommended: true },
  });
  return Response.json({ ok: true, items: items.map((i) => ({ id: i.id, name: i.name, sortOrder: i.sortOrder, isAvailable: i.isAvailable, isFeatured: i.isRecommended })) });
}

const Body = z.object({
  items: z.array(z.object({ id: z.string(), sortOrder: z.number().int().min(0).max(9999), isFeatured: z.boolean() })).max(1000),
});

export async function PATCH(req: NextRequest) {
  const restaurant = await requireRestaurant();
  const { items } = Body.parse(await req.json());
  const branchIds = await ownedBranchIds(restaurant.id);
  const rows = await prisma.menuItem.findMany({ where: { id: { in: items.map((i) => i.id) } }, select: { id: true, branchId: true } });
  const owned = new Set(rows.filter((r) => branchIds.has(r.branchId)).map((r) => r.id));
  await prisma.$transaction(
    items.filter((i) => owned.has(i.id)).map((i) =>
      prisma.menuItem.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder, isRecommended: i.isFeatured } }),
    ),
  );
  return Response.json({ ok: true, updated: owned.size });
}
