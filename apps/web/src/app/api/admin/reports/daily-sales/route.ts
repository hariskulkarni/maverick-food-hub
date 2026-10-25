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
    select: { placedAt: true, subtotal: true, total: true, taxAmount: true, deliveryFee: true }
  });

  const buckets = new Map<string, { orders: number; gross: number; net: number; tax: number; delivery: number }>();
  for (const o of orders) {
    const day = istDayKey(o.placedAt);
    const b = buckets.get(day) ?? { orders: 0, gross: 0, net: 0, tax: 0, delivery: 0 };
    b.orders += 1;
    b.gross += Number(o.total);
    b.net += Number(o.subtotal);
    b.tax += Number(o.taxAmount);
    b.delivery += Number(o.deliveryFee);
    buckets.set(day, b);
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => [day, b.orders, b.net.toFixed(2), b.tax.toFixed(2), b.delivery.toFixed(2), b.gross.toFixed(2)]);

  return deliverReport({
    format,
    headers: ['date', 'orders', 'netSales', 'tax', 'deliveryFee', 'grossSales'],
    rows,
    basename: 'daily-sales'
  });
});
