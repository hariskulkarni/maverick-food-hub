/**
 * GET /api/platform/rider-shifts — read view of rider shifts joined with
 * rider name/phone. Super-admin only. Filter by ?status, ?from, ?to (date).
 */
import { NextRequest } from 'next/server';
import { requireCapability } from '@/server/tenancy';
import { prisma } from '@/server/db';
import { serializeShift } from './_serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireCapability('riders:read');
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
