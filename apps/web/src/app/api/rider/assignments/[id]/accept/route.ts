import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { AssignmentStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accept a dispatcher-pushed (PENDING) assignment. P1-7: only PENDING →
 * ACCEPTED, as a conditional write — a CANCELLED/REJECTED/DELIVERED assignment
 * can never be revived (the load slot was already given back when it closed).
 * Re-accepting an ACCEPTED assignment is an idempotent no-op.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  const a = await prisma.riderAssignment.findUnique({ where: { id } });
  if (!a || !profile || a.riderId !== profile.id) return new Response('Not found', { status: 404 });

  const res = await prisma.riderAssignment.updateMany({
    where: { id: a.id, riderId: profile.id, status: AssignmentStatus.PENDING },
    data: { status: AssignmentStatus.ACCEPTED, acceptedAt: new Date() }
  });
  const current = await prisma.riderAssignment.findUnique({ where: { id: a.id } });
  if (res.count === 1 || current?.status === AssignmentStatus.ACCEPTED) return Response.json(current);
  return Response.json({ error: 'This order is no longer offered to you.' }, { status: 409 });
}
