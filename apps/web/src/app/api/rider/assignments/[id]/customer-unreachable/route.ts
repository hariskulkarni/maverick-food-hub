/**
 * POST /api/rider/assignments/[id]/customer-unreachable
 * Body: { note?: string }
 * Rider can't get the customer on the phone / at the door. We:
 *   1. Transition the order to CUSTOMER_UNREACHABLE (non-terminal — admin
 *      may still recover this into DELIVERED or escalate to DELIVERY_FAILED).
 *   2. Open an OrderEscalation (CUSTOMER_UNREACHABLE, HIGH) so it lights
 *      up live-ops immediately.
 *   3. Record the rider's note on the assignment for context.
 *
 * Tenancy: rider must own the assignment.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { transitionOrder } from '@/server/orders';

const Body = z.object({ note: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  const { note } = Body.parse(await req.json().catch(() => ({})));

  await transitionOrder(a.orderId, 'CUSTOMER_UNREACHABLE' as any, {
    actorId: session.user.id,
    note: note ?? 'Rider reports customer unreachable'
  });

  // Stamp note on the assignment + open an OPEN escalation (idempotent — don't
  // double-open if admin already has one in flight for this order).
  await prisma.riderAssignment.update({
    where: { id: a.id },
    data: { notes: ((a.notes ?? '') + `\n[customer-unreachable] ${note ?? ''}`).trim() }
  });
  const existing = await prisma.orderEscalation.findFirst({
    where: { orderId: a.orderId, type: 'CUSTOMER_UNREACHABLE' as any, status: 'OPEN' }
  });
  if (!existing) {
    await prisma.orderEscalation.create({
      data: {
        orderId: a.orderId,
        type: 'CUSTOMER_UNREACHABLE' as any,
        severity: 'HIGH' as any,
        message: `Rider could not reach customer${note ? `: ${note}` : ''}`
      }
    });
  }

  return Response.json({ ok: true });
}
