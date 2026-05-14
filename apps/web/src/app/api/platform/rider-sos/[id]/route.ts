/**
 * PATCH /api/platform/rider-sos/[id] — resolve or cancel an SOS alert.
 * Body: { status: 'RESOLVED' | 'CANCELLED', resolvedNote?: string }
 * Resolving an already-closed alert returns 409.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { serializeSos } from '../_serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  status: z.enum(['RESOLVED', 'CANCELLED']),
  resolvedNote: z.string().max(2000).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const body = Body.parse(await req.json());

  const before = await prisma.sosAlert.findUnique({ where: { id } });
  if (!before) return new Response('SOS alert not found', { status: 404 });
  if (before.status !== 'ACTIVE') {
    return new Response('SOS alert is already closed', { status: 409 });
  }

  const after = await prisma.sosAlert.update({
    where: { id },
    data: {
      status: body.status,
      resolvedAt: new Date(),
      resolvedNote: body.resolvedNote ?? null,
    },
    include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
  });

  await audit('rider.sos.resolve', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'SosAlert',
    entityId: id,
    before: { status: before.status },
    after: { status: after.status, resolvedNote: after.resolvedNote },
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ alert: serializeSos(after) });
}
