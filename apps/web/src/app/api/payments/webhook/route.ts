import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import { PaymentStatus } from '@prisma/client';

export async function POST(req: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const raw = await req.text();
  if (secret) {
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const got = req.headers.get('x-razorpay-signature') || '';
    if (expected !== got) return new Response('Invalid signature', { status: 400 });
  }
  const body = JSON.parse(raw);
  if (body.event === 'payment.captured') {
    const orderId = body.payload?.payment?.entity?.notes?.orderId;
    const providerPaymentId = body.payload?.payment?.entity?.id;
    const providerOrderId = body.payload?.payment?.entity?.order_id;
    if (orderId && providerOrderId) {
      const p = await prisma.payment.findFirst({ where: { orderId, providerRef: providerOrderId } });
      if (p) await prisma.payment.update({ where: { id: p.id }, data: { status: PaymentStatus.CAPTURED, providerRef: providerPaymentId } });
    }
  }
  return Response.json({ ok: true });
}
