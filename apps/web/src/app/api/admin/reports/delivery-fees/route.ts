import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { istDayKey } from '@/lib/ist';
import { REVENUE_STATUS_FILTER } from '@/server/reports/revenue';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, deliverReport, reportRoute } from '@/server/reports/range';

export const dynamic = 'force-dynamic';

export const GET = reportRoute(async (req: NextRequest) => {
  const { branchIds } = await requireAdminReportScope();
  const { from, to, format } = parseRange(new URL(req.url));

  const orders = await prisma.order.findMany({
    where: {
      branchId: { in: branchIds },
      placedAt: { gte: from, lte: to },
      status: REVENUE_STATUS_FILTER
    },
    select: { placedAt: true, deliveryFee: true }
  });

  const buckets = new Map<string, { fees: number; count: number }>();
  for (const o of orders) {
    const day = istDayKey(o.placedAt);
    const b = buckets.get(day) ?? { fees: 0, count: 0 };
    b.fees += Number(o.deliveryFee);
    b.count += 1;
    buckets.set(day, b);
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => [day, b.fees.toFixed(2), b.count]);

  return deliverReport({
    format,
    headers: ['date', 'fees', 'count'],
    rows,
    basename: 'delivery-fees'
  });
});
