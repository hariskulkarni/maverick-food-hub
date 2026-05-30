/**
 * /api/platform/kyc/[id]
 *
 *   GET   — single doc detail (masked number + rider context). SUPER_ADMIN only.
 *   PATCH — review action. SUPER_ADMIN only. Body:
 *             { action: 'approve' | 'reject' | 'mark-expired', rejectionReason?: string }
 *
 * Status transitions enforced by `assertTransition` in src/server/kyc.ts.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { assertTransition, toPublicDoc } from '@/server/kyc';
import { optionalString } from '@/server/zod-helpers';
import { KycDocumentStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const doc = await prisma.riderKycDocument.findUnique({
    where: { id },
    include: {
      rider: {
        select: {
          id: true,
          vehicleType: true,
          vehicleNumber: true,
          user: { select: { id: true, name: true, phone: true, email: true } }
        }
      }
    }
  });
  if (!doc) return new Response('Not found', { status: 404 });
  return Response.json({ document: { ...toPublicDoc(doc), rider: doc.rider } });
}

const PatchBody = z.object({
  action: z.enum(['approve', 'reject', 'mark-expired']),
  rejectionReason: optionalString(500)
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch (e) {
    return new Response((e as Error).message || 'Invalid body', { status: 400 });
  }

  if (body.action === 'reject' && !body.rejectionReason) {
    return new Response('rejectionReason is required when rejecting.', { status: 400 });
  }

  const doc = await prisma.riderKycDocument.findUnique({ where: { id } });
  if (!doc) return new Response('Not found', { status: 404 });

  const toStatus: KycDocumentStatus =
    body.action === 'approve' ? 'APPROVED'
    : body.action === 'reject' ? 'REJECTED'
    : 'EXPIRED';

  assertTransition(doc.status, toStatus);

  const updated = await prisma.riderKycDocument.update({
    where: { id },
    data: {
      status: toStatus,
      reviewedAt: new Date(),
      reviewedBy: session.user.id,
      rejectionReason: body.action === 'reject' ? body.rejectionReason ?? null : null
    }
  });

  const auditAction =
    body.action === 'approve' ? 'kyc.approve'
    : body.action === 'reject' ? 'kyc.reject'
    : 'kyc.expire';

  await audit(auditAction, {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'RiderKycDocument',
    entityId: id,
    before: { status: doc.status, rejectionReason: doc.rejectionReason },
    after: { status: updated.status, rejectionReason: updated.rejectionReason }
  });

  return Response.json({ document: toPublicDoc(updated) });
}
