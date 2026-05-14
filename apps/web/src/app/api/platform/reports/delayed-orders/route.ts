import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { parseRange, deliverReport } from '@/server/reports/range';

// SLA target end-to-end (placedAt → deliveredAt) in minutes.
// 45 min is the platform-wide default; can be made per-restaurant later.
const SLA_MIN = 45;

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { from, to, format } = parseRange(new URL(req.url));

  const orders = await prisma.order.findMany({
    where: {
      status: 'DELIVERED',
      placedAt: { gte: from, lte: to },
      deliveredAt: { not: null }
    },
    select: {
      code: true,
      placedAt: true,
      deliveredAt: true,
      branch: { select: { restaurant: { select: { name: true } } } }
    }
  });

  const rows: unknown[][] = [];
  for (const o of orders) {
    if (!o.deliveredAt) continue;
    const actualMin = Math.round((o.deliveredAt.getTime() - o.placedAt.getTime()) / 60000);
    if (actualMin <= SLA_MIN) continue;
    rows.push([
      o.code,
      o.branch.restaurant.name,
      o.placedAt.toISOString(),
      o.deliveredAt.toISOString(),
      SLA_MIN,
      actualMin
    ]);
  }

  rows.sort((a, b) => Number(b[5]) - Number(a[5]));

  return deliverReport({
    format,
    headers: ['code', 'restaurant', 'placedAt', 'deliveredAt', 'slaMin', 'actualMin'],
    rows,
    basename: 'delayed-orders'
  });
}
