/**
 * POST /api/platform/cod/:id/mark-mismatch
 * Body: { amount?: number; notes?: string }
 *
 * Flags a COD collection as MISMATCH (rider deposited wrong amount). The
 * `amount` is recorded as the actual collected figure for investigation.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';

const Body = z.object({
  amount: z.number().min(0).optional(),
  notes: z.string().optional()
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const body = Body.parse(await req.json().catch(() => ({})));

  const before = await prisma.codCollection.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  const after = await prisma.codCollection.update({
    where: { id },
    data: {
      status: 'MISMATCH',
      amountCollected: (body.amount ?? Number(before.amountCollected ?? 0)) as any,
      notes: body.notes ?? before.notes,
      collectedAt: before.collectedAt ?? new Date()
    }
  });

  await audit('cod.reconcile', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityId: id,
    before: { status: before.status, amountCollected: before.amountCollected },
    after:  { status: after.status,  amountCollected: after.amountCollected, reason: 'MISMATCH' },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });

  return Response.json(after);
}
