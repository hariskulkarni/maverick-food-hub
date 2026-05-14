import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { parseRange, deliverReport } from '@/server/reports/range';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { from, to, format } = parseRange(new URL(req.url));

  const rows = await prisma.order.groupBy({
    by: ['paymentMethod'],
    _sum: { total: true },
    _count: { _all: true },
    where: {
      placedAt: { gte: from, lte: to },
      status: { notIn: ['CANCELLED', 'PAYMENT_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN'] }
    }
  });

  const out = rows
    .sort((a, b) => Number(b._sum.total ?? 0) - Number(a._sum.total ?? 0))
    .map((r) => [r.paymentMethod, r._count._all, Number(r._sum.total ?? 0).toFixed(2)]);

  return deliverReport({
    format,
    headers: ['method', 'count', 'amount'],
    rows: out,
    basename: 'payment-mode-split'
  });
}
