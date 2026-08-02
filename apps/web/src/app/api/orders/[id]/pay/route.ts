/**
 * POST /api/orders/[id]/pay
 *
 * Opens a fresh gateway checkout for an order that is not yet paid — the "retry
 * payment" path. Needed because a PhonePe PayPage expires (15 min by default)
 * and its merchantOrderId cannot be reused, so a customer returning to an
 * unpaid order needs a new session rather than the stale token URL.
 *
 * Also the entry point for the pay-later flow: an order placed online but
 * abandoned at the PayPage can be paid from the order detail page.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';
import { startOnlinePayment, OnlinePaymentError, isOnlineMethod } from '@/server/payments/online';
import { log } from '@/server/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { name: 'order-pay', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, customerId: true, status: true, paymentMethod: true },
  });
  if (!order) return new Response('Not found', { status: 404 });
  if (order.customerId !== session.user.id && session.user.role === 'CUSTOMER') {
    return new Response('Forbidden', { status: 403 });
  }
  if (!isOnlineMethod(order.paymentMethod)) {
    return Response.json({ error: 'This order is not an online payment.', reason: 'bad_method' }, { status: 400 });
  }

  try {
    const paySession = await startOnlinePayment(order.id);
    return Response.json({ ok: true, payment: paySession });
  } catch (e) {
    if (e instanceof OnlinePaymentError) {
      return Response.json({ error: e.message, reason: 'payment_start_failed' }, { status: e.status });
    }
    log.error({ err: (e as Error).message, orderId: order.id }, 'retry payment failed');
    return Response.json({ error: 'Could not start the payment.', reason: 'payment_start_failed' }, { status: 502 });
  }
}
