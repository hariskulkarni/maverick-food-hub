import { NextRequest } from 'next/server';
import { z } from 'zod';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { requireOwnedOrder } from '../../_helpers';
import { OrderStatus } from '@prisma/client';

const Body = z.object({ status: z.nativeEnum(OrderStatus), note: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // C12: role gate + tenant ownership. Cross-tenant id → 404, never a transition.
  const scope = await requireOwnedOrder(id);
  if ('error' in scope) return scope.error;
  const session = scope.session;
  const body = Body.parse(await req.json());
  try {
    const o = await transitionOrder(id, body.status, {
      actorId: session?.user.id,
      note: body.note,
      scopeRestaurantId: scope.scopeRestaurantId ?? undefined
    });
    return Response.json(o);
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
