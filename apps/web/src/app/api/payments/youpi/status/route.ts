/**
 * GET /api/payments/youpi/status?orderId=…
 *
 * Customer-driven status poll for the payment-status page. Mirrors the PhonePe
 * status route but delegates to reconcileYoupiPayment, the single writer that
 * may capture a YouPI payment (status + UTR + exact amount verified). This
 * route never marks anything paid itself.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';
import { reconcileYoupiPayment } from '@/server/payments/youpi-reconcile';
import { userCanAccessRestaurant } from '@/server/tenancy';
import { PaymentStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'youpi-status', limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const orderId = new URL(req.url).searchParams.get('orderId');
  if (!orderId) return Response.json({ error: 'orderId is required', reason: 'bad_body' }, { status: 400 });

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      code: true,
      customerId: true,
      branch: { select: { restaurantId: true } },
      status: true,
      payments: {
        where: { providerName: 'youpi' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, errorMessage: true },
      },
    },
  });
  if (!order) return new Response('Not found', { status: 404 });
  if (session.user.role === 'CUSTOMER') {
    if (order.customerId !== session.user.id) return new Response('Forbidden', { status: 403 });
  } else if (session.user.role !== 'SUPER_ADMIN') {
    const ok = await userCanAccessRestaurant(session.user.id, order.branch.restaurantId);
    if (!ok) return new Response('Forbidden', { status: 403 });
  }

  const payment = order.payments[0];
  if (!payment) {
    return Response.json({ orderId: order.id, orderCode: order.code, state: 'NONE', orderStatus: order.status });
  }

  if (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.REFUNDED) {
    return Response.json({ orderId: order.id, orderCode: order.code, state: 'COMPLETED', paymentStatus: payment.status });
  }

  const outcome = await reconcileYoupiPayment(payment.id);
  return Response.json({
    orderId: order.id,
    orderCode: order.code,
    // Only a verified CAPTURED is COMPLETED; everything else stays PENDING/FAILED.
    state:
      outcome.status === PaymentStatus.CAPTURED ? 'COMPLETED' : outcome.status === PaymentStatus.FAILED ? 'FAILED' : 'PENDING',
    paymentStatus: outcome.status,
    indeterminate: Boolean(outcome.indeterminate),
    error: payment.errorMessage ?? undefined,
  });
}
