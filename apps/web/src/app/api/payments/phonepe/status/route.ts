/**
 * GET /api/payments/phonepe/status?orderId=…
 *
 * Authenticated status poll used by the payment-status page while a PhonePe
 * payment is still settling (UPI collect can take a minute; the webhook may
 * arrive before, after, or — if the tenant misconfigured the dashboard — never).
 *
 * Every call reconciles against PhonePe's Order Status API, so this doubles as
 * the customer-driven recovery path when no webhook shows up. Rate-limited
 * because it is a paid upstream call the browser drives.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';
import { reconcilePhonePePayment } from '@/server/payments/reconcile';
import { PaymentStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'phonepe-status', limit: 60, windowMs: 60_000 });
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
      status: true,
      payments: {
        where: { providerName: 'phonepe' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, errorMessage: true },
      },
    },
  });
  if (!order) return new Response('Not found', { status: 404 });
  // Customers may only poll their own orders.
  if (order.customerId !== session.user.id && session.user.role === 'CUSTOMER') {
    return new Response('Forbidden', { status: 403 });
  }

  const payment = order.payments[0];
  if (!payment) {
    return Response.json({ orderId: order.id, orderCode: order.code, state: 'NONE', orderStatus: order.status });
  }

  // Skip the upstream call when the payment is already terminal.
  if (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.REFUNDED) {
    return Response.json({
      orderId: order.id,
      orderCode: order.code,
      state: 'COMPLETED',
      paymentStatus: payment.status,
      orderStatus: order.status,
    });
  }

  const outcome = await reconcilePhonePePayment(payment.id);

  return Response.json({
    orderId: order.id,
    orderCode: order.code,
    state:
      outcome.status === PaymentStatus.CAPTURED
        ? 'COMPLETED'
        : outcome.status === PaymentStatus.FAILED
          ? 'FAILED'
          : 'PENDING',
    paymentStatus: outcome.status,
    // True when the gateway was unreachable — the client keeps polling instead
    // of showing the customer a failure we are not sure about.
    indeterminate: Boolean(outcome.indeterminate),
    error: outcome.error ?? payment.errorMessage ?? undefined,
    orderStatus: outcome.captured ? undefined : order.status,
  });
}
