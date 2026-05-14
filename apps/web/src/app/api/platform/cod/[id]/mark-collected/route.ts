/**
 * POST /api/platform/cod/:id/mark-collected
 * Body: { amount?: number; notes?: string }
 *
 * Marks a COD collection as fully or partially collected. If the collected
 * amount equals amountToCollect the status becomes COLLECTED; if it's less
 * (but > 0) it becomes PARTIAL_COLLECTED.
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

  const due = Number(before.amountToCollect);
  const collected = body.amount ?? due;
  const status = collected >= due ? 'COLLECTED' : collected > 0 ? 'PARTIAL_COLLECTED' : 'PENDING_COLLECTION';

  const after = await prisma.codCollection.update({
    where: { id },
    data: {
      amountCollected: collected as any,
      status,
      collectedAt: new Date(),
      notes: body.notes ?? before.notes
    }
  });

  await audit('cod.collect', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityId: id,
    before: { status: before.status, amountCollected: before.amountCollected, collectedAt: before.collectedAt },
    after:  { status: after.status,  amountCollected: after.amountCollected,  collectedAt: after.collectedAt },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });

  return Response.json(after);
}
