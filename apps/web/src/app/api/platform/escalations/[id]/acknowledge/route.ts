/**
 * POST /api/platform/escalations/[id]/acknowledge
 * Marks an OrderEscalation as ACKNOWLEDGED. SUPER_ADMIN only.
 * Optional ?note=... captured in the audit entry.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { auth } from '@/server/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const note = new URL(req.url).searchParams.get('note') ?? undefined;

  const before = await prisma.orderEscalation.findUnique({
    where: { id },
    select: { id: true, orderId: true, status: true, type: true, severity: true }
  });
  if (!before) return new Response('Not found', { status: 404 });

  const updated = await prisma.orderEscalation.update({
    where: { id },
    data: { status: 'ACKNOWLEDGED' }
  });

  await audit('order.escalation.acknowledge', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'OrderEscalation',
    entityId: id,
    before,
    after: { status: updated.status, note },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  });

  return Response.json({ ok: true, escalation: updated });
}
