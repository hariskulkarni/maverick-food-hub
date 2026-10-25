/**
 * PATCH /api/platform/rider-incidents/[id] — update status and/or resolution.
 * Body: { status?: IncidentStatus, resolution?: string | null }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { serializeIncident } from '../_serializers';
import { clientIp } from '@/server/http/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    status: z.enum(['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED']).optional(),
    resolution: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.resolution !== undefined, {
    message: 'Nothing to update',
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const session = await auth();
  const { id } = await params;
  const body = Body.parse(await req.json());

  const before = await prisma.riderIncidentReport.findUnique({ where: { id } });
  if (!before) return new Response('Incident report not found', { status: 404 });

  const data: any = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.resolution !== undefined) data.resolution = body.resolution;

  const after = await prisma.riderIncidentReport.update({
    where: { id },
    data,
    include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
  });

  await audit('rider.incident.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderIncidentReport',
    entityId: id,
    before: { status: before.status, resolution: before.resolution },
    after: { status: after.status, resolution: after.resolution },
    ipAddress: clientIp(req.headers) ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ incident: serializeIncident(after) });
}
