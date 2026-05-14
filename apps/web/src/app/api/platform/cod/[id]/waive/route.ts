/**
 * POST /api/platform/cod/:id/waive
 * Body: { amount?: number; notes?: string }
 *
 * Writes off the COD owed (e.g., refunded order, exceptional case). The
 * `notes` field should explain why — it shows in audit trail.
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
      status: 'WAIVED',
      amountCollected: (body.amount ?? before.amountCollected ?? 0) as any,
      reconciledAt: new Date(),
      reconciledBy: session?.user?.id ?? null,
      notes: body.notes ?? before.notes
    }
  });

  await audit('cod.waive', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityId: id,
    before: { status: before.status, amountToCollect: before.amountToCollect, notes: before.notes },
    after:  { status: after.status,  notes: after.notes },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });

  return Response.json(after);
}
