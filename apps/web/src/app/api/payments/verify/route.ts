import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { paymentProvider, isPhonePePayment } from '@/server/payments';
import { PaymentStatus } from '@prisma/client';
import { rateLimit } from '@/server/http/rate-limit';
import { auth } from '@/server/auth';

const Body = z.object({
  orderId: z.string(),
  providerOrderId: z.string(),
  providerPaymentId: z.string(),
  signature: z.string()
});

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'payment-verify', limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  // C3: this route was unauthenticated and csrfGuard lets a plain curl reach it.
  // Require a session and verify the caller owns the order being verified.
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const data = Body.parse(await req.json());
  // Look up the order's restaurant (to pick the tenant's creds) and its owner.
  const orderRow = await prisma.order.findUnique({
    where: { id: data.orderId },
    select: { customerId: true, branch: { select: { restaurantId: true } } }
  });
  if (!orderRow || orderRow.customerId !== session.user.id) {
    return new Response('Not found', { status: 404 });
  }

  const payment = await prisma.payment.findFirst({ where: { orderId: data.orderId, providerRef: data.providerOrderId } });
  if (!payment) return new Response('Payment not found', { status: 404 });
  // Flavrly PG (direct UPI) is captured only by bank-evidence allocation, never
  // by a browser-driven verify call against the tenant's default gateway.
  if (payment.providerName === 'youpi') {
    return Response.json({ ok: false, error: 'This payment is verified by bank reconciliation.' }, { status: 409 });
  }
  const provider = await paymentProvider(orderRow.branch?.restaurantId);
  const verified = await provider.verifyPayment({ providerOrderId: data.providerOrderId, providerPaymentId: data.providerPaymentId, signature: data.signature });

  if (!verified.ok) {
    // C3: an indeterminate result (gateway unreachable / UNKNOWN) is NOT a
    // payment failure. Leave the payment PENDING for the reconciler rather than
    // marking a possibly-captured order FAILED — the opposite of the old code,
    // which marked payments FAILED exactly when PhonePe was down.
    if (verified.status === 'UNKNOWN') {
      return Response.json(
        { ok: false, pending: true, error: 'Payment status could not be confirmed yet; it remains pending' },
        { status: 202 }
      );
    }
    // Genuine failure. Only walk a still-PENDING payment to FAILED — a CAPTURED
    // payment must never be moved backwards (status precondition in the where).
    await prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.FAILED, errorMessage: verified.error }
    });
    return new Response(verified.error || 'Failed', { status: 400 });
  }

  // Success → CAPTURED, but only from a non-terminal state so a replay can't
  // re-capture or clobber a refunded/failed row. For PhonePe, do NOT overwrite
  // providerRef: refunds are addressed by the original merchantOrderId and
  // losing it here would strand the refund path (mirrors reconcile.ts).
  await prisma.payment.updateMany({
    where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.AUTHORIZED] } },
    data: {
      status: PaymentStatus.CAPTURED,
      errorMessage: null,
      ...(isPhonePePayment(payment.providerName) ? {} : { providerRef: data.providerPaymentId }),
      providerData: { ...((payment.providerData as object | null) ?? {}), captured: true } as any
    }
  });
  return Response.json({ ok: true });
}
