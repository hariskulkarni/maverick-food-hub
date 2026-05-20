/**
 *   PATCH  /api/admin/freebies/[id] — edit a freebie rule (name, threshold, gift
 *           item, stock, sortOrder, isActive). A "restock" is just a PATCH with
 *           a new/higher `stock`.
 *   DELETE /api/admin/freebies/[id] — delete the rule.
 *
 * The rule must belong to the signed-in admin's primary branch. ADMIN only.
 * When changing the gift item, the new menuItemId must also belong to the branch.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { primaryBranchForCurrentRestaurant, menuItemInBranch, serializeFreebieRule } from '../_helpers';

export const dynamic = 'force-dynamic';

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  menuItemId: z.string().min(1).optional(),
  minOrderAmount: z.number().min(0).max(1_000_000).optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branch } = await primaryBranchForCurrentRestaurant();
  const { id } = await params;

  const existing = await prisma.freebieRule.findFirst({ where: { id, branchId: branch.id } });
  if (!existing) return new Response('Not found', { status: 404 });

  const data = PatchBody.parse(await req.json());

  if (data.menuItemId !== undefined && !(await menuItemInBranch(data.menuItemId, branch.id))) {
    return new Response('Gift item does not belong to this branch', { status: 400 });
  }

  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.menuItemId !== undefined) patch.menuItemId = data.menuItemId;
  if (data.minOrderAmount !== undefined) patch.minOrderAmount = data.minOrderAmount;
  if (data.stock !== undefined) patch.stock = data.stock;
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const updated = await prisma.freebieRule.update({
    where: { id },
    data: patch,
    include: { menuItem: { select: { name: true } } }
  });
  return Response.json(serializeFreebieRule(updated));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const { branch } = await primaryBranchForCurrentRestaurant();
  const { id } = await params;

  const existing = await prisma.freebieRule.findFirst({ where: { id, branchId: branch.id } });
  if (!existing) return new Response('Not found', { status: 404 });

  // Orders reference the rule via Order.freebieRuleId with onDelete unset
  // (defaults to SetNull on an optional relation), so a hard delete is safe —
  // past attributions just lose the link.
  await prisma.freebieRule.delete({ where: { id } });
  return Response.json({ ok: true });
}
