/**
 * POST /api/rider/assignments/[id]/reach-customer
 * Rider taps "I'm at the customer's door" — transitions order to
 * RIDER_REACHED_CUSTOMER so customer sees "Rider is at your door" and the
 * OTP-entry flow becomes the primary action on the rider side.
 *
 * Tenancy: rider must own the assignment.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { transitionOrder } from '@/server/orders';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  await prisma.riderAssignment.update({
    where: { id: a.id },
    data: { notes: ((a.notes ?? '') + '\n[reached-customer ' + new Date().toISOString() + ']').trim() }
  });
  try {
    await transitionOrder(a.orderId, 'RIDER_REACHED_CUSTOMER' as any, { actorId: session.user.id });
  } catch {
    // Idempotent / already past — non-fatal.
  }
  return Response.json({ ok: true });
}
