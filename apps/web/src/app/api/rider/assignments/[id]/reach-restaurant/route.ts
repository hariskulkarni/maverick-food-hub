/**
 * POST /api/rider/assignments/[id]/reach-restaurant
 * Rider taps "I'm at the restaurant" — we flip the order into the
 * RIDER_REACHED_RESTAURANT visibility state so kitchen/admin can see the
 * rider waiting. The assignment row's own status stays ACCEPTED (PICKED_UP
 * comes later); we just stamp a notes flag so the UI knows we've reached.
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

  // Stamp a marker on the assignment so we can show "Waiting at restaurant" badge.
  // We keep AssignmentStatus on ACCEPTED — picked-up is a separate explicit step.
  await prisma.riderAssignment.update({
    where: { id: a.id },
    data: { notes: ((a.notes ?? '') + '\n[reached-restaurant ' + new Date().toISOString() + ']').trim() }
  });
  try {
    await transitionOrder(a.orderId, 'RIDER_REACHED_RESTAURANT' as any, { actorId: session.user.id });
  } catch {
    // Order may already be past this state — non-fatal.
  }
  return Response.json({ ok: true });
}
