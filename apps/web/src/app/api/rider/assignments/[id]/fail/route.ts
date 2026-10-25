/**
 * POST /api/rider/assignments/[id]/fail
 * Body: { reason: CancellationReason, note?: string }
 *
 * The rider can't complete this job (P2-21). Two cases:
 *
 *   BEFORE pickup (assignment PENDING/ACCEPTED): the order itself is fine, only
 *   the rider leg failed (vehicle issue, emergency, restaurant problem). We
 *   release the assignment, free the rider's load slot and put the order back
 *   in the pool for another rider → { ok, outcome: 'released' }.
 *
 *   AFTER pickup (PICKED_UP): the order moves to DELIVERY_FAILED (assignment +
 *   load released by transitionOrder), the reason is stamped on the order, and
 *   a captured online payment is queued for refund → { ok, outcome: 'failed' }.
 *
 * Tenancy: rider must own the assignment. Audited either way.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { transitionOrder, OrderTransitionError } from '@/server/orders';
import { releaseAssignmentBeforePickup } from '@/server/rider-assignment-release';
import { audit } from '@/server/audit';
import { clientIp } from '@/server/http/client-ip';
import { publish } from '@/server/realtime';
import { notifyRidersOfNewOrder } from '@/server/rider-push';
import { AssignmentStatus, CancellationReason, OrderStatus, PaymentStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    reason: z.nativeEnum(CancellationReason),
    note: z.string().trim().max(500).optional()
  })
  .refine((b) => b.reason !== CancellationReason.OTHER || (b.note ?? '').length >= 5, {
    message: 'Tell us briefly what happened.'
  });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id }, include: { order: { include: { payments: true } } } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Choose a reason.' }, { status: 400 });
  }
  const { reason, note } = parsed.data;
  const ip = clientIp(req.headers);

  // ── Before pickup: hand the order back to the pool ─────────────────────────
  if (a.status === AssignmentStatus.PENDING || a.status === AssignmentStatus.ACCEPTED) {
    const released = await prisma.$transaction((tx) => releaseAssignmentBeforePickup(tx, a.id));
    if (!released) return Response.json({ error: 'This order is no longer assigned to you.' }, { status: 409 });
    await audit('rider.assignment.release', {
      actorId: session.user.id,
      actorRole: session.user.role,
      entityType: 'Order',
      entityId: a.orderId,
      before: { assignmentId: a.id, riderId: a.riderId, assignmentStatus: a.status },
      after: { released: true, reason, note: note ?? null },
      ipAddress: ip
    });
    if (a.order.status === OrderStatus.READY) {
      publish('rider:pool', { kind: 'order:new', orderId: a.orderId, branchId: a.order.branchId });
      notifyRidersOfNewOrder(a.orderId).catch(() => {});
    }
    publish(`order:${a.orderId}`, { kind: 'status', orderId: a.orderId, status: a.order.status, at: new Date().toISOString() });
    return Response.json({ ok: true, outcome: 'released' });
  }

  if (a.status !== AssignmentStatus.PICKED_UP) {
    return Response.json({ error: 'This delivery is already closed.' }, { status: 409 });
  }

  // ── After pickup: the delivery failed ──────────────────────────────────────
  const before = { status: a.order.status, cancellationReason: a.order.cancellationReason, cancelReason: a.order.cancelReason };
  try {
    await transitionOrder(a.orderId, OrderStatus.DELIVERY_FAILED, { actorId: session.user.id, note: note ?? reason });
  } catch (e) {
    if (e instanceof OrderTransitionError) {
      return Response.json({ error: 'This order can no longer be marked as failed. Contact support.' }, { status: 409 });
    }
    throw e;
  }
  await prisma.order.update({
    where: { id: a.orderId },
    data: { cancellationReason: reason, cancelReason: note ?? reason, cancelledBy: session.user.id }
  });
  await prisma.riderAssignment.update({
    where: { id: a.id },
    data: { notes: ((a.notes ?? '') + `\n[fail:${reason}] ${note ?? ''}`).trim() }
  });

  // If money was already taken, chain into REFUND_PENDING so finance/admin
  // sees an action item. CAPTURED is the post-collection state for online pay.
  const capturedPayment = a.order.payments.find((p) => p.status === PaymentStatus.CAPTURED);
  if (capturedPayment) {
    try {
      await transitionOrder(a.orderId, OrderStatus.REFUND_PENDING, { actorId: session.user.id, note: `Auto-queued after delivery failure (${reason})` });
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
    ipAddress: ip
  });

  return Response.json({ ok: true, outcome: 'failed' });
}
