import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { PaymentStatus } from '@prisma/client';
import { auth } from '@/server/auth';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const order = await prisma.order.findUnique({ where: { id }, include: { payments: true } });
  if (!order || order.customerId !== session.user.id) return new Response('Not found', { status: 404 });
  const payment = order.payments.find((p) => p.status === PaymentStatus.PENDING);
  if (payment && payment.providerName === 'mock') {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.CAPTURED } });
  }
  return Response.json({ ok: true });
}
