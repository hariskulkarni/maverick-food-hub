import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { CANCELLED_STATUSES } from '@/server/reports/revenue';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, deliverReport, reportRoute } from '@/server/reports/range';

export const dynamic = 'force-dynamic';

export const GET = reportRoute(async (req: NextRequest) => {
  const { branchIds } = await requireAdminReportScope();
  const { from, to, format } = parseRange(new URL(req.url));

  const orders = await prisma.order.findMany({
    where: {
      branchId: { in: branchIds },
      // P1-7: a cancellation that was later refunded has moved on to REFUND_*,
      // so match on the cancellation stamp (set by every CANCELLED_* transition)
      // rather than the current status; legacy rows without the stamp still
      // match on status + placedAt.
      OR: [
        { cancelledAt: { gte: from, lte: to } },
        { cancelledAt: null, status: { in: CANCELLED_STATUSES }, placedAt: { gte: from, lte: to } }
      ]
    },
    select: {
      code: true,
      status: true,
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
    return [o.code, o.status, o.customer.name ?? o.customer.phone ?? '', reason, refunded.toFixed(2)];
  });

  return deliverReport({
    format,
    headers: ['code', 'status', 'customer', 'reason', 'refundedAmount'],
    rows,
    basename: 'cancelled-orders'
  });
});
