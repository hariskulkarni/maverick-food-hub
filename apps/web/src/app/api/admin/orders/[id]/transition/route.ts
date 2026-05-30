import { NextRequest } from 'next/server';
import { z } from 'zod';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { requireAnyAdminApi } from '@/server/api-auth';
import { OrderStatus } from '@prisma/client';

const Body = z.object({ status: z.nativeEnum(OrderStatus), note: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireAnyAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const body = Body.parse(await req.json());
  try {
    const o = await transitionOrder(id, body.status, { actorId: session?.user.id, note: body.note });
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
