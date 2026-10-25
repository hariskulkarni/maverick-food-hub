import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { REVENUE_STATUS_FILTER } from '@/server/reports/revenue';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, deliverReport, reportRoute } from '@/server/reports/range';
import { splitPgPaymentModes } from '@/server/payment-mode-label';

export const dynamic = 'force-dynamic';

export const GET = reportRoute(async (req: NextRequest) => {
  const { branchIds } = await requireAdminReportScope();
  const { from, to, format } = parseRange(new URL(req.url));

  const where: Prisma.OrderWhereInput = {
    branchId: { in: branchIds },
    placedAt: { gte: from, lte: to },
    status: REVENUE_STATUS_FILTER
  };
  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where
  });

  // Flavrly PG orders get their own row instead of being counted as RAZORPAY/PHONEPE.
  const out = (await splitPgPaymentModes(rows, where)).map((r) => [r.mode, r.count, r.amount.toFixed(2)]);

  return deliverReport({
    format,
    headers: ['method', 'count', 'amount'],
    rows: out,
    basename: 'payment-mode'
  });
});
