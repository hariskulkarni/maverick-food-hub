/**
 * GET /api/platform/cod — rider-wise COD pending summary.
 * Filters: ?riderId, ?status, ?from, ?to
 */
import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/server/tenancy';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const url = new URL(req.url);
  const riderId = url.searchParams.get('riderId') || undefined;
  const status = url.searchParams.get('status') || undefined;
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: any = {};
  if (riderId) where.riderId = riderId;
  if (status)  where.status  = status;
  if (from || to) where.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) };

  const collections = await prisma.codCollection.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      order: { select: { code: true, total: true } },
      rider: { include: { user: { select: { name: true, phone: true } } } }
    },
    take: 500
  });

  // Per-rider summary for the top strip
  const summary = await prisma.codCollection.groupBy({
    by: ['riderId', 'status'],
    _sum: { amountToCollect: true, amountCollected: true }
  });

  return Response.json({ collections, summary });
}
