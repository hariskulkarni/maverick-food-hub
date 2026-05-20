/**
 *   GET  /api/admin/freebies  — list this branch's freebie rules (sortOrder, then threshold)
 *   POST /api/admin/freebies  — create a freebie rule for this branch
 *
 * Scoped to the signed-in admin's primary branch. ADMIN only. zod validation.
 * The gift item (menuItemId) must belong to this branch.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { primaryBranchForCurrentRestaurant, menuItemInBranch, serializeFreebieRule } from './_helpers';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  menuItemId: z.string().min(1),
  minOrderAmount: z.number().min(0).max(1_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional()
});

export async function GET() {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branch } = await primaryBranchForCurrentRestaurant();

  const rules = await prisma.freebieRule.findMany({
    where: { branchId: branch.id },
    include: { menuItem: { select: { name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { minOrderAmount: 'asc' }]
  });
  return Response.json({ branchId: branch.id, rules: rules.map(serializeFreebieRule) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branch } = await primaryBranchForCurrentRestaurant();

  const data = CreateBody.parse(await req.json());

  if (!(await menuItemInBranch(data.menuItemId, branch.id))) {
    return new Response('Gift item does not belong to this branch', { status: 400 });
  }

  const created = await prisma.freebieRule.create({
    data: {
      branchId: branch.id,
      menuItemId: data.menuItemId,
      name: data.name,
      minOrderAmount: data.minOrderAmount,
      stock: data.stock,
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true
    },
    include: { menuItem: { select: { name: true } } }
  });
  return Response.json(serializeFreebieRule(created));
}
