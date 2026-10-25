import { NextRequest } from 'next/server';
import { z } from 'zod';
import { OrderStatus, Role } from '@prisma/client';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { prisma } from '@/server/db';
import { activeMembership } from '@/server/tenancy';
import { parseOrJsonError } from '@/server/zod-helpers';
import { sourceForRole } from '@/server/dispatch/events';
import { requireOwnedOrder, orderScopeWhere } from '../../_helpers';
import { staffTransitionError, afterRestaurantCancel } from '../../_staff-transition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ status: z.nativeEnum(OrderStatus), note: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + tenant ownership. Cross-tenant id → 404, never a transition.
  const scope = await requireOwnedOrder(id);
  if ('error' in scope) return scope.error;
  const session = scope.session;
  const body = parseOrJsonError(Body, await req.json().catch(() => null));
  if (body instanceof Response) return body;

  const order = await prisma.order.findFirst({
    where: orderScopeWhere(id, scope.scopeRestaurantId),
    select: { status: true, fulfillmentType: true },
  });
  if (!order) return Response.json({ error: 'Order not found.', reason: 'not_found' }, { status: 404 });

  // P0-3: staff may only drive operational targets; the MEMBERSHIP role (not
  // the global role) decides who may cancel.
  const role = session.user.role === Role.SUPER_ADMIN
    ? Role.SUPER_ADMIN
    : (await activeMembership())?.role ?? Role.KITCHEN;
  const denied = staffTransitionError(order, body.status, role);
  if (denied) return Response.json({ error: denied.error, reason: 'illegal_transition' }, { status: denied.status });

  try {
    const wasAlready = order.status === body.status;
    let o = await transitionOrder(id, body.status, {
      actorId: session?.user.id,
      note: body.note,
      scopeRestaurantId: scope.scopeRestaurantId ?? undefined,
      eventSource: sourceForRole((session?.user as { role?: string } | undefined)?.role)
    });
    let refundQueued = false;
    if (body.status === OrderStatus.CANCELLED_BY_RESTAURANT && !wasAlready) {
      // P1-11: a captured payment must not be stranded in a terminal cancel.
      refundQueued = await afterRestaurantCancel(id, session?.user.id, body.note);
      if (refundQueued) o = await prisma.order.findUniqueOrThrow({ where: { id } });
    }
    // DTO only — never the raw row (the idempotent path carries the customer relation).
    return Response.json({ id: o.id, code: o.code, status: o.status, refundQueued });
  } catch (e) {
    if (e instanceof OrderTransitionError) {
      return Response.json(
        { error: e.message, reason: 'illegal_transition' },
        { status: 400 }
      );
    }
    throw e;
  }
}
