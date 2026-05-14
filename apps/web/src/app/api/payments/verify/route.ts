import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { paymentProvider } from '@/server/payments';
import { PaymentStatus } from '@prisma/client';

const Body = z.object({
  orderId: z.string(),
  providerOrderId: z.string(),
  providerPaymentId: z.string(),
  signature: z.string()
});

export async function POST(req: NextRequest) {
  const data = Body.parse(await req.json());
  // Look up the order's restaurant so we pick the tenant's payment creds.
  const orderRow = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: { branch: { select: { restaurantId: true } } }
  });
  const provider = await paymentProvider(orderRow?.branch?.restaurantId);
  const verified = await provider.verifyPayment({ providerOrderId: data.providerOrderId, providerPaymentId: data.providerPaymentId, signature: data.signature });
  const payment = await prisma.payment.findFirst({ where: { orderId: data.orderId, providerRef: data.providerOrderId } });
  if (!payment) return new Response('Payment not found', { status: 404 });
  if (!verified.ok) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, errorMessage: verified.error } });
    return new Response(verified.error || 'Failed', { status: 400 });
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: PaymentStatus.CAPTURED, providerRef: data.providerPaymentId, providerData: { ...(payment.providerData as object | null ?? {}), captured: true } as any }
  });
  return Response.json({ ok: true });
}
