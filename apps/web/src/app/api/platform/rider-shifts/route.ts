/**
 * GET /api/platform/rider-shifts — read view of rider shifts joined with
 * rider name/phone. Super-admin only. Filter by ?status, ?from, ?to (date).
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function serializeShift(s: any) {
  return {
    id: s.id,
    riderId: s.riderId,
    // `@db.Date` — keep only the calendar date portion.
    date: s.date.toISOString().slice(0, 10),
    startTime: s.startTime,
    endTime: s.endTime,
    zoneName: s.zoneName ?? null,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    rider: {
      id: s.rider?.id ?? s.riderId,
      name: s.rider?.user?.name ?? null,
      phone: s.rider?.user?.phone ?? null,
    },
  };
}

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') || undefined;
  const from = sp.get('from');
  const to = sp.get('to');

  const where: any = {};
  if (status) where.status = status;
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const shifts = await prisma.riderShift.findMany({
    where,
    orderBy: [{ date: 'desc' }, { startTime: 'asc' }],
    include: { rider: { include: { user: { select: { name: true, phone: true } } } } },
    take: 500,
  });

  return Response.json({ shifts: shifts.map(serializeShift) });
}
