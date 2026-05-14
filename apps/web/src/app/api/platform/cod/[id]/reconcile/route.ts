/**
 * POST /api/platform/cod/:id/reconcile
 * Body: { amount?: number; notes?: string }
 *
 * Final settlement — money has hit the company bank account; record who
 * reconciled and when.
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
      status: 'RECONCILED',
      amountCollected: (body.amount ?? before.amountCollected ?? before.amountToCollect) as any,
      reconciledAt: new Date(),
      reconciledBy: session?.user?.id ?? null,
      notes: body.notes ?? before.notes
    }
  });

  await audit('cod.reconcile', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityId: id,
    before: { status: before.status, reconciledAt: before.reconciledAt, reconciledBy: before.reconciledBy },
    after:  { status: after.status,  reconciledAt: after.reconciledAt,  reconciledBy: after.reconciledBy },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });

  return Response.json(after);
}
