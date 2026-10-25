import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { ADMIN_BOARD_INCLUDE } from '@/server/staff-orders';
import { requireOrderAdminScope, orderScopeWhere } from '../_helpers';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: this returned customer PII, full address + coordinates and the rider
  // record for ANY order id, any tenant. Scope the query to the caller's
  // restaurant (super-admin unrestricted) so it fails closed.
  const scope = await requireOrderAdminScope();
  if ('error' in scope) return scope.error;
  const o = await prisma.order.findFirst({
    where: orderScopeWhere(id, scope.scopeRestaurantId),
    include: ADMIN_BOARD_INCLUDE // P2-13: customer/rider as {id,name,phone}, never full User rows
  });
  if (!o) return Response.json({ error: 'Order not found.', reason: 'not_found' }, { status: 404 });
  return Response.json(o);
}
