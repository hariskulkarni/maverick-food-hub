/**
 * POST /api/orders/[id]/tip   { amount: number }
 * Customer adds a tip for the rider, post-delivery. Updates the assignment
 * earnings and the rider's totalTips.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

const Body = z.object({ amount: z.number().min(1).max(2000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const order = await prisma.order.findUnique({ where: { id }, include: { assignment: true } });
  if (!order || order.customerId !== session.user.id) return new Response('Not found', { status: 404 });
  if (!order.assignment) return new Response('No rider on this order', { status: 400 });

  const { amount } = Body.parse(await req.json());

  const updated = await prisma.$transaction(async (tx) => {
    const newTip = Number(order.assignment!.tipAmt) + amount;
    const newEarnings = Number(order.assignment!.baseEarningsAmt) + Number(order.assignment!.bonusAmt) + newTip;
    const a = await tx.riderAssignment.update({
      where: { id: order.assignment!.id },
      data: { tipAmt: newTip as any, earningsAmt: newEarnings as any }
    });
    await tx.riderProfile.update({ where: { id: a.riderId }, data: { totalTips: { increment: amount as any } } });
    return a;
  });
  return Response.json(updated);
}
