/**
 * GET /api/platform/rider-sos — all SOS alerts joined with rider name/phone.
 * Super-admin only. ACTIVE alerts surfaced first; filter by ?status.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function serializeSos(a: any) {
  return {
    id: a.id,
    riderId: a.riderId,
    assignmentId: a.assignmentId ?? null,
    lat: a.lat == null ? null : Number(a.lat),
    lng: a.lng == null ? null : Number(a.lng),
    status: a.status,
    note: a.note ?? null,
    triggeredAt: a.triggeredAt.toISOString(),
    resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    resolvedNote: a.resolvedNote ?? null,
    rider: {
      id: a.rider?.id ?? a.riderId,
      name: a.rider?.user?.name ?? null,
      phone: a.rider?.user?.phone ?? null,
    },
  };
}

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const status = req.nextUrl.searchParams.get('status') || undefined;

  const where: any = {};
  if (status) where.status = status;

  const alerts = await prisma.sosAlert.findMany({
    where,
    orderBy: [{ status: 'asc' }, { triggeredAt: 'desc' }],
    include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
    take: 500,
  });

  // ACTIVE first regardless of enum ordering.
  const rows = alerts.map(serializeSos).sort((a, b) => {
    if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
    if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
    return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime();
  });

  return Response.json({ alerts: rows });
}
