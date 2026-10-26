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
    select: { placedAt: true, taxAmount: true }
  });

  const buckets = new Map<string, number>();
  for (const o of orders) {
    const day = istDayKey(o.placedAt);
    buckets.set(day, (buckets.get(day) ?? 0) + Number(o.taxAmount));
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, tax]) => [day, tax.toFixed(2)]);

  return deliverReport({
    format,
    headers: ['date', 'taxCollected'],
    rows,
    basename: 'taxes'
  });
});
