import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, deliverReport } from '@/server/reports/range';

const CANCELLED_STATUSES = ['CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN'] as const;

export async function GET(req: NextRequest) {
  const { branchIds } = await requireAdminReportScope();
  const { from, to, format } = parseRange(new URL(req.url));

  const orders = await prisma.order.findMany({
    where: {
      branchId: { in: branchIds },
      status: { in: CANCELLED_STATUSES as any },
      OR: [
        { cancelledAt: { gte: from, lte: to } },
        { placedAt: { gte: from, lte: to } }
      ]
    },
    select: {
      code: true,
      cancelReason: true,
      cancellationReason: true,
      customer: { select: { name: true, phone: true } },
      refunds: { select: { amount: true } }
    },
    orderBy: { cancelledAt: 'desc' }
  });

  const rows = orders.map((o) => {
    const refunded = o.refunds.reduce((s, r) => s + Number(r.amount), 0);
    const reason = o.cancellationReason ?? o.cancelReason ?? '';
    return [o.code, o.customer.name ?? o.customer.phone ?? '', reason, refunded.toFixed(2)];
  });

  return deliverReport({
    format,
    headers: ['code', 'customer', 'reason', 'refundedAmount'],
    rows,
    basename: 'cancelled-orders'
  });
}
