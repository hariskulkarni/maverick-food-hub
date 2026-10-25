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
import { requireSuperAdminApi } from '@/server/api-auth';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { clientIp } from '@/server/http/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  status: z.enum(['PAID', 'FAILED']),
  reference: z.string().max(120).optional().nullable(),
  note: z.string().max(500).optional().nullable()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const session = await auth();
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'status must be PAID or FAILED' }, { status: 400 });
  const data = parsed.data;

  const before = await prisma.riderPayout.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  // P1-6: conditional settle — only a still-open payout can move, so a late
  // FAILED can never overwrite PAID (which would make paid money withdrawable
  // again) and two admins can't both settle the same request.
  const res = await prisma.riderPayout.updateMany({
    where: { id, status: { in: ['REQUESTED', 'PROCESSING'] } },
    data: {
      status: data.status,
      processedAt: new Date(),
      reference: data.reference ?? before.reference,
      note: data.note ?? before.note
    }
  });
  if (res.count === 0) {
    const now = await prisma.riderPayout.findUnique({ where: { id }, select: { status: true } });
    return new Response(`Payout already ${now?.status ?? before.status}`, { status: 409 });
  }
  const after = await prisma.riderPayout.findUniqueOrThrow({ where: { id } });

  await audit('rider.payout.settle', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderPayout',
    entityId: id,
    before: { status: before.status, amount: Number(before.amount) },
    after: { status: after.status, reference: after.reference },
    ipAddress: clientIp(req.headers),
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
