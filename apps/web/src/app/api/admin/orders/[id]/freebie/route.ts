/**
 *   DELETE /api/admin/orders/[id]/freebie — remove the freebie from an order:
 *           delete the isFreebie OrderItem line, clear order.freebieRuleId, and
 *           restore one unit of the rule's stock.
 *   POST   /api/admin/orders/[id]/freebie — swap the freebie to a different gift
 *           item belonging to the same freebie rule's branch. Body: { menuItemId }.
 *
 * Only allowed while the order is RECEIVED or ACCEPTED (before prep starts).
 * The order must belong to the signed-in admin's primary branch. ADMIN only.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { restoreFreebieStock } from '@/server/freebies';
import { primaryBranchForCurrentRestaurant, menuItemInBranch } from '../../../freebies/_helpers';

export const dynamic = 'force-dynamic';

const EDITABLE_STATUSES = ['RECEIVED', 'ACCEPTED'] as const;

const SwapBody = z.object({
  menuItemId: z.string().min(1)
});

async function loadEditableOrder(id: string, branchId: string) {
  const order = await prisma.order.findFirst({
    where: { id, branchId },
    include: { items: true }
  });
  return order;
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const { branch } = await primaryBranchForCurrentRestaurant();
  const { id } = await params;

  const order = await loadEditableOrder(id, branch.id);
  if (!order) return Response.json({ error: 'Order not found', reason: 'not_found' }, { status: 404 });
  if (!EDITABLE_STATUSES.includes(order.status as any)) {
    return Response.json({ error: 'Freebie can only be changed before prep (RECEIVED/ACCEPTED)', reason: 'status_locked' }, { status: 409 });
  }

  const freebieLine = order.items.find((i) => i.isFreebie);
  const ruleId = order.freebieRuleId;
  if (!freebieLine && !ruleId) {
    return Response.json({ error: 'This order has no freebie', reason: 'no_freebie' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (freebieLine) await tx.orderItem.delete({ where: { id: freebieLine.id } });
    await tx.order.update({ where: { id: order.id }, data: { freebieRuleId: null } });
  });

  // Restore stock outside the txn (helper opens its own connection + is
  // best-effort against a since-deleted rule).
  if (ruleId) await restoreFreebieStock(ruleId);

  return Response.json({ ok: true, removed: true });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const { branch } = await primaryBranchForCurrentRestaurant();
  const { id } = await params;

  const data = SwapBody.parse(await req.json());

  const order = await loadEditableOrder(id, branch.id);
  if (!order) return Response.json({ error: 'Order not found', reason: 'not_found' }, { status: 404 });
  if (!EDITABLE_STATUSES.includes(order.status as any)) {
    return Response.json({ error: 'Freebie can only be changed before prep (RECEIVED/ACCEPTED)', reason: 'status_locked' }, { status: 409 });
  }

  const freebieLine = order.items.find((i) => i.isFreebie);
  if (!freebieLine) return Response.json({ error: 'This order has no freebie to swap', reason: 'no_freebie' }, { status: 404 });

  if (!(await menuItemInBranch(data.menuItemId, branch.id))) {
    return Response.json({ error: 'Gift item does not belong to this branch', reason: 'item_not_in_branch' }, { status: 400 });
  }

  const newItem = await prisma.menuItem.findUnique({
    where: { id: data.menuItemId },
    select: { name: true }
  });

  const updated = await prisma.orderItem.update({
    where: { id: freebieLine.id },
    data: {
      menuItemId: data.menuItemId,
      name: newItem?.name ?? freebieLine.name,
      unitPrice: new Prisma.Decimal(0),
      isFreebie: true
    }
  });

  return Response.json({ ok: true, swapped: true, itemName: updated.name });
}
