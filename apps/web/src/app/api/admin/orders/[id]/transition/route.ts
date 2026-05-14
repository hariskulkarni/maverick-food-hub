import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { OrderStatus } from '@prisma/client';

const Body = z.object({ status: z.nativeEnum(OrderStatus), note: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!['ADMIN', 'KITCHEN'].includes(session?.user.role || '')) return new Response('Forbidden', { status: 403 });
  const body = Body.parse(await req.json());
  try {
    const o = await transitionOrder(id, body.status, { actorId: session?.user.id, note: body.note });
    return Response.json(o);
  } catch (e) {
    if (e instanceof OrderTransitionError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
