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
import { currentRestaurant } from '@/server/tenancy';

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
    select: { id: true, customerId: true, status: true, paymentMethod: true, branch: { select: { restaurantId: true } } },
  });
  if (!order) return new Response('Not found', { status: 404 });
  // Only the ordering customer, staff of the order's own restaurant, or a
  // super-admin may open a checkout. Other roles were previously unchecked.
  const role = session.user.role;
  if (order.customerId !== session.user.id) {
    if (role === 'SUPER_ADMIN') {
      /* platform-wide */
    } else if (role === 'ADMIN' || role === 'KITCHEN') {
      const r = await currentRestaurant();
      if (!r || r.id !== order.branch.restaurantId) return new Response('Forbidden', { status: 403 });
    } else {
      return new Response('Forbidden', { status: 403 });
    }
  }
  if (!isOnlineMethod(order.paymentMethod)) {
    return Response.json({ error: 'This order is not an online payment.', reason: 'bad_method' }, { status: 400 });
  }
  // H14: only an order still awaiting payment may open a checkout. Previously
  // there was no status check, so a CANCELLED/REFUNDED/DELIVERED order could be
  // paid. Allow-list the pre-fulfilment payable states (fails closed).
  const PAYABLE = ['PAYMENT_PENDING', 'PAYMENT_FAILED'];
  if (!PAYABLE.includes(order.status)) {
    return Response.json({ error: 'This order can no longer be paid.', reason: 'not_payable' }, { status: 409 });
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
