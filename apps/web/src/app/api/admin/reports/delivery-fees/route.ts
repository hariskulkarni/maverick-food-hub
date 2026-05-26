import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, deliverReport } from '@/server/reports/range';

export async function GET(req: NextRequest) {
  const { branchIds } = await requireAdminReportScope();
  const { from, to, format } = parseRange(new URL(req.url));

  const orders = await prisma.order.findMany({
    where: {
      branchId: { in: branchIds },
      placedAt: { gte: from, lte: to },
      status: { notIn: ['CANCELLED', 'PAYMENT_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN'] }
    },
    select: { placedAt: true, deliveryFee: true }
  });

  const buckets = new Map<string, { fees: number; count: number }>();
  for (const o of orders) {
    const day = o.placedAt.toISOString().slice(0, 10);
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
}
