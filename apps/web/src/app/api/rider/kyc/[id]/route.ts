/**
 * DELETE /api/rider/kyc/[id]
 *
 * The rider may delete their own KYC document (so they can re-upload). Only
 * permitted when the doc is not currently APPROVED — once approved, removal
 * goes through super-admin review.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true }
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const doc = await prisma.riderKycDocument.findUnique({ where: { id } });
  if (!doc || doc.riderId !== profile.id) return new Response('Not found', { status: 404 });

  if (doc.status === 'APPROVED') {
    return new Response('Approved documents cannot be self-deleted; contact support.', { status: 409 });
  }

  await prisma.riderKycDocument.delete({ where: { id } });

  await audit('kyc.delete', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'RiderKycDocument',
    entityId: id,
    before: {
      type: doc.type,
      status: doc.status,
      numberLast4: doc.numberLast4,
      fileUrl: doc.fileUrl
    },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip')
  });

  return Response.json({ ok: true });
}
