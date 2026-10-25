import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { REVENUE_STATUS_FILTER } from '@/server/reports/revenue';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, deliverReport, reportRoute } from '@/server/reports/range';

export const dynamic = 'force-dynamic';

export const GET = reportRoute(async (req: NextRequest) => {
  const { branchIds } = await requireAdminReportScope();
  const { from, to, format } = parseRange(new URL(req.url));

  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where: {
      branchId: { in: branchIds },
      placedAt: { gte: from, lte: to },
      status: REVENUE_STATUS_FILTER
    }
  });

  const out = rows
    .sort((a, b) => Number(b._sum.total ?? 0) - Number(a._sum.total ?? 0))
    .map((r) => [r.paymentMethod, r._count._all, Number(r._sum.total ?? 0).toFixed(2)]);

  return deliverReport({
    format,
    headers: ['method', 'count', 'amount'],
    rows: out,
    basename: 'payment-mode'
  });
});
