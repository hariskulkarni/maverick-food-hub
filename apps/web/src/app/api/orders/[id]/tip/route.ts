/**
 * POST /api/orders/[id]/tip   { amount: number }
 * Customer adds a tip for the rider, post-delivery. Updates the assignment
 * earnings and the rider's totalTips.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseOrJsonError } from '@/server/zod-helpers';
import { rateLimit } from '@/server/http/rate-limit';
import { OrderStatus } from '@prisma/client';

const Body = z.object({ amount: z.number().min(1).max(2000) });

// H16: states in which a tip is meaningful (a rider is/was on the delivery).
const TIPPABLE: OrderStatus[] = [
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
  OrderStatus.DELIVERED
];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  // H16: this route raised the rider payable with NO customer charge, no
  // idempotency, no rate limit and no order-status check — repeatable at ₹2000 a
  // call. Bound it: per-user rate limit, valid-state only, and one tip per order
  // (set-once), so platform exposure is capped at the single-call max per order.
  const rl = await rateLimit(req, { name: 'order-tip', limit: 5, windowMs: 600_000, key: session.user.id });
  if (!rl.ok) return rl.response;

  const order = await prisma.order.findUnique({ where: { id }, include: { assignment: true } });
  if (!order || order.customerId !== session.user.id) return new Response('Not found', { status: 404 });
  if (!order.assignment) return new Response('No rider on this order', { status: 400 });
  if (!TIPPABLE.includes(order.status)) {
    return new Response('This order is not in a tippable state.', { status: 409 });
  }
  if (Number(order.assignment.tipAmt) > 0) {
    return new Response('This order has already been tipped.', { status: 409 });
  }

  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const { amount } = parsed;

  // H16: single-winner set-once write guarded on tipAmt still being 0, so a
  // concurrent double-submit can't both apply. NOTE (flagged for Phase 2): the
  // tip still credits rider earnings with no matching customer charge — tips must
  // be routed through the payment/ledger layer before GA. See status doc.
  const updated = await prisma.$transaction(async (tx) => {
    const applied = await tx.riderAssignment.updateMany({
      where: { id: order.assignment!.id, tipAmt: 0 },
      data: {
        tipAmt: amount as any,
        earningsAmt: (Number(order.assignment!.baseEarningsAmt) + Number(order.assignment!.bonusAmt) + amount) as any
      }
    });
    if (applied.count === 0) return null;
    await tx.riderProfile.update({ where: { id: order.assignment!.riderId }, data: { totalTips: { increment: amount as any } } });
    return tx.riderAssignment.findUnique({ where: { id: order.assignment!.id } });
  });
  if (!updated) return new Response('This order has already been tipped.', { status: 409 });
  return Response.json(updated);
}
