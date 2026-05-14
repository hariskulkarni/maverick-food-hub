/**
 * PATCH /api/platform/rider-payouts/:id
 * Body: { status: 'PAID' | 'FAILED'; reference?: string; note?: string }
 *
 * Settles a rider withdrawal request. Only REQUESTED / PROCESSING payouts can
 * be moved to a terminal state; stamps `processedAt`. Audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  status: z.enum(['PAID', 'FAILED']),
  reference: z.string().max(120).optional().nullable(),
  note: z.string().max(500).optional().nullable()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = Body.parse(await req.json());

  const before = await prisma.riderPayout.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });
  if (before.status === 'PAID' || before.status === 'FAILED') {
    return new Response(`Payout already ${before.status}`, { status: 409 });
  }

  const after = await prisma.riderPayout.update({
    where: { id },
    data: {
      status: data.status,
      processedAt: new Date(),
      reference: data.reference ?? before.reference,
      note: data.note ?? before.note
    }
  });

  await audit('rider.payout.settle', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderPayout',
    entityId: id,
    before: { status: before.status, amount: Number(before.amount) },
    after: { status: after.status, reference: after.reference },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({
    id: after.id,
    status: after.status,
    reference: after.reference,
    note: after.note,
    processedAt: after.processedAt
  });
}
