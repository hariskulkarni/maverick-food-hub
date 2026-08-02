/**
 * Rider-initiated digital collection for a cash-on-delivery order.
 *
 *   POST /api/rider/assignments/[id]/collect-online  → open a PhonePe PayPage
 *   GET  /api/rider/assignments/[id]/collect-online  → poll until it settles
 *
 * Why this exists: a large share of Indian doorstep "cash" orders end with the
 * customer wanting to pay by UPI instead. Today the rider has no way to accept
 * that, so the amount lands in `CodCollection` as cash-in-hand they must carry
 * and later deposit. This lets the rider hand over their phone (or show a UPI
 * QR), take the money digitally, and settle the COD record on the spot.
 *
 * There is no PhonePe *mobile SDK* involved: the rider app opens the same
 * PayPage URL the web checkout uses, in an in-app browser. That keeps one
 * capture path — the PayPage, the webhook, the status API and the sweeper are
 * all shared with web checkout, so a rider-collected payment reconciles through
 * exactly the same code as a customer-collected one.
 *
 * Safety: the amount is always the order total (never rider-supplied), the
 * assignment must belong to the calling rider, and the order must not already
 * be paid.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { log } from '@/server/log';
import { rateLimit } from '@/server/http/rate-limit';
import { startOnlinePayment, OnlinePaymentError } from '@/server/payments/online';
import { reconcilePhonePePayment } from '@/server/payments/reconcile';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The assignment, if it belongs to the authenticated rider. */
async function riderAssignment(assignmentId: string, userId: string) {
  const profile = await prisma.riderProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return null;
  const assignment = await prisma.riderAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      riderId: true,
      order: {
        select: {
          id: true,
          code: true,
          total: true,
          paymentMethod: true,
          payments: {
            where: { providerName: 'phonepe' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, status: true, errorMessage: true },
          },
        },
      },
    },
  });
  if (!assignment || assignment.riderId !== profile.id) return null;
  return assignment;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { name: 'rider-collect-online', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const { id } = await params;
  const assignment = await riderAssignment(id, session.user.id);
  if (!assignment) return new Response('Not found', { status: 404 });

  const order = assignment.order;
  if (order.paymentMethod !== PaymentMethod.COD) {
    return Response.json(
      { error: 'This order is not cash on delivery.', reason: 'not_cod' },
      { status: 400 },
    );
  }

  try {
    // The rider never supplies the amount — it is always the order total.
    const paySession = await startOnlinePayment(order.id, {
      method: PaymentMethod.PHONEPE,
      amount: Number(order.total),
      // Shorter than web checkout: the rider is standing at the door.
      expireAfterSec: 300,
    });
    log.info({ orderId: order.id, riderId: assignment.riderId }, 'rider opened digital COD collection');
    return Response.json({
      ok: true,
      orderCode: order.code,
      amount: Number(order.total),
      payment: paySession,
    });
  } catch (e) {
    if (e instanceof OnlinePaymentError) {
      return Response.json({ error: e.message, reason: 'payment_start_failed' }, { status: e.status });
    }
    log.error({ err: (e as Error).message, orderId: order.id }, 'rider digital COD collection failed');
    return Response.json({ error: 'Could not start the payment.', reason: 'payment_start_failed' }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rl = await rateLimit(req, { name: 'rider-collect-status', limit: 60, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const { id } = await params;
  const assignment = await riderAssignment(id, session.user.id);
  if (!assignment) return new Response('Not found', { status: 404 });

  const payment = assignment.order.payments[0];
  if (!payment) return Response.json({ state: 'NONE' });

  if (payment.status === PaymentStatus.CAPTURED || payment.status === PaymentStatus.REFUNDED) {
    return Response.json({ state: 'COMPLETED', paymentStatus: payment.status });
  }

  const outcome = await reconcilePhonePePayment(payment.id);
  return Response.json({
    state:
      outcome.status === PaymentStatus.CAPTURED
        ? 'COMPLETED'
        : outcome.status === PaymentStatus.FAILED
          ? 'FAILED'
          : 'PENDING',
    paymentStatus: outcome.status,
    indeterminate: Boolean(outcome.indeterminate),
    error: outcome.error ?? payment.errorMessage ?? undefined,
  });
}
