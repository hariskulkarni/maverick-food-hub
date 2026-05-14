/**
 * POST /api/rider/assignments/[id]/fail
 * Body: { reason: CancellationReason, note?: string }
 *
 * Terminal-ish failure path. We:
 *   1. Transition order → DELIVERY_FAILED
 *   2. Stamp Order.cancellationReason + cancelReason (the free-text note)
 *   3. audit('order.fail', …) for the trail
 *   4. If payment was already captured (Razorpay etc.), kick off a
 *      REFUND_PENDING follow-up so finance/admin can issue the refund.
 *
 * Tenancy: rider must own the assignment.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { transitionOrder } from '@/server/orders';
import { audit } from '@/server/audit';
import { CancellationReason, PaymentStatus } from '@prisma/client';

const Body = z.object({
  reason: z.nativeEnum(CancellationReason),
  note: z.string().max(500).optional()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id }, include: { order: { include: { payments: true } } } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  const { reason, note } = Body.parse(await req.json());

  const before = { status: a.order.status, cancellationReason: a.order.cancellationReason, cancelReason: a.order.cancelReason };

  await transitionOrder(a.orderId, 'DELIVERY_FAILED' as any, { actorId: session.user.id, note: note ?? reason });
  await prisma.order.update({
    where: { id: a.orderId },
    data: { cancellationReason: reason, cancelReason: note ?? reason, cancelledBy: session.user.id }
  });
  await prisma.riderAssignment.update({
    where: { id: a.id },
    data: { notes: ((a.notes ?? '') + `\n[fail:${reason}] ${note ?? ''}`).trim() }
  });

  // If money was already taken, chain into REFUND_PENDING so finance/admin
  // sees an action item. CAPTURED is the post-collection state for Razorpay.
  const capturedPayment = a.order.payments.find((p) => p.status === PaymentStatus.CAPTURED);
  if (capturedPayment) {
    try {
      await transitionOrder(a.orderId, 'REFUND_PENDING' as any, { actorId: session.user.id, note: `Auto-queued after delivery failure (${reason})` });
    } catch {
      // Some prior state may block the transition — admin can still drive it manually.
    }
  }

  await audit('order.fail', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'Order',
    entityId: a.orderId,
    before,
    after: { status: 'DELIVERY_FAILED', cancellationReason: reason, cancelReason: note ?? reason, paymentCaptured: !!capturedPayment },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });

  return Response.json({ ok: true });
}
