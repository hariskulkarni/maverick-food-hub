/**
 * GET /api/platform/rider-incidents — all rider incident reports joined with
 * rider name/phone. Super-admin only. Filter by ?status and ?type.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function serializeIncident(i: any) {
  return {
    id: i.id,
    riderId: i.riderId,
    assignmentId: i.assignmentId ?? null,
    type: i.type,
    status: i.status,
    description: i.description,
    lat: i.lat == null ? null : Number(i.lat),
    lng: i.lng == null ? null : Number(i.lng),
    photoUrl: i.photoUrl ?? null,
    resolution: i.resolution ?? null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    rider: {
      id: i.rider?.id ?? i.riderId,
      name: i.rider?.user?.name ?? null,
      phone: i.rider?.user?.phone ?? null,
    },
  };
}

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') || undefined;
  const type = sp.get('type') || undefined;

  const where: any = {};
  if (status) where.status = status;
  if (type) where.type = type;

  const incidents = await prisma.riderIncidentReport.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
    take: 500,
  });

  return Response.json({ incidents: incidents.map(serializeIncident) });
}
