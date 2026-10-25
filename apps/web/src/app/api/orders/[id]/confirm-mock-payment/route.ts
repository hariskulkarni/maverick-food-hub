import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { PaymentStatus } from '@prisma/client';
import { auth } from '@/server/auth';
import { releaseOrderAfterCapture } from '@/server/payments/reconcile';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // C2: this route flips a PENDING mock payment straight to CAPTURED. It must
  // never be reachable in production — only on dev or an explicit demo
  // deployment. In production it 404s as if it did not exist.
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_MODE !== 'true') {
    return new Response('Not found', { status: 404 });
  }

  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const order = await prisma.order.findUnique({ where: { id }, include: { payments: true } });
  if (!order || order.customerId !== session.user.id) return new Response('Not found', { status: 404 });
  const payment = order.payments.find((p) => p.status === PaymentStatus.PENDING);
  if (payment && payment.providerName === 'mock') {
    const r = await prisma.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.PENDING }, data: { status: PaymentStatus.CAPTURED } });
    // Online orders wait in PAYMENT_PENDING; the (dev-only) mock capture releases them like a real one.
    if (r.count === 1) await releaseOrderAfterCapture(order.id, 'Payment captured (mock)');
  }
  return Response.json({ ok: true });
}
