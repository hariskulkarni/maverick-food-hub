/**
 * GET /api/platform/rider-incidents — all rider incident reports joined with
 * rider name/phone. Super-admin only. Filter by ?status and ?type.
 */
import { NextRequest } from 'next/server';
import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { serializeIncident } from './_serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireCapability('riders:read');
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
