/**
 * POST /api/rider/kyc/[id]/reverify
 *
 * Re-runs the live verifier against an existing KYC document. Useful when the
 * vendor was temporarily down (status `ERROR`) or returned `FAIL` and the
 * rider has corrected something out-of-band. Tenancy: only the document's
 * owner rider can re-verify; APPROVED rows can't be re-verified (they already
 * passed and an admin would have to intervene).
 *
 * Supports only PAN_CARD and DRIVING_LICENSE — Insurance and RC have no
 * authoritative live source, so the request is rejected with 422.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { decryptDocNumber, liveVerifyAndPersist, toPublicDoc } from '@/server/kyc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true, user: { select: { name: true } } }
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const doc = await prisma.riderKycDocument.findUnique({ where: { id } });
  if (!doc || doc.riderId !== profile.id) return new Response('Not found', { status: 404 });

  if (doc.type !== 'PAN_CARD' && doc.type !== 'DRIVING_LICENSE') {
    return new Response(
      'Live re-verification is only available for PAN and Driving License.',
      { status: 422 }
    );
  }
  if (doc.status === 'APPROVED') {
    return new Response('Document is already approved.', { status: 409 });
  }

  const raw = decryptDocNumber(doc.numberEncrypted);
  if (!raw) return new Response('Document number unavailable for re-verification.', { status: 409 });

  await liveVerifyAndPersist(id, {
    type: doc.type,
    rawNumber: raw,
    fullName: profile.user?.name ?? undefined
  });

  const fresh = await prisma.riderKycDocument.findUnique({ where: { id } });
  if (!fresh) return new Response('Not found', { status: 404 });
  return Response.json({ document: toPublicDoc(fresh) });
}
