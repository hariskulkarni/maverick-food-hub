import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { AssignmentStatus } from '@prisma/client';
import { transitionOrder } from '@/server/orders';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });
  const u = await prisma.riderAssignment.update({ where: { id: a.id }, data: { status: AssignmentStatus.PICKED_UP, pickedUpAt: new Date() } });
  // also progress order to OUT_FOR_DELIVERY if it's still READY
  const order = await prisma.order.findUnique({ where: { id: a.orderId } });
  if (order?.status === 'READY') await transitionOrder(order.id, 'OUT_FOR_DELIVERY' as any, { actorId: session.user.id });
  return Response.json(u);
}
