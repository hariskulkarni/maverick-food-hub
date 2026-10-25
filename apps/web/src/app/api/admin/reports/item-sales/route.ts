import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { REVENUE_STATUS_FILTER } from '@/server/reports/revenue';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, deliverReport, reportRoute } from '@/server/reports/range';

export const dynamic = 'force-dynamic';

export const GET = reportRoute(async (req: NextRequest) => {
  const { branchIds } = await requireAdminReportScope();
  const { from, to, format } = parseRange(new URL(req.url));

  const items = await prisma.orderItem.findMany({
    where: {
      order: {
        branchId: { in: branchIds },
        placedAt: { gte: from, lte: to },
        status: REVENUE_STATUS_FILTER
      }
    },
    select: { menuItemId: true, comboId: true, name: true, quantity: true, unitPrice: true }
  });

  const agg = new Map<string, { id: string; name: string; qty: number; revenue: number }>();
  for (const i of items) {
    // Group by menuItemId | comboId | name fallback.
    const id = i.menuItemId ?? i.comboId ?? `name:${i.name}`;
    const row = agg.get(id) ?? { id, name: i.name, qty: 0, revenue: 0 };
    row.qty += i.quantity;
    row.revenue += Number(i.unitPrice) * i.quantity;
    agg.set(id, row);
  }

  const rows = Array.from(agg.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((r) => [r.id, r.name, r.qty, r.revenue.toFixed(2)]);

  return deliverReport({
    format,
    headers: ['itemId', 'name', 'qtySold', 'revenue'],
    rows,
    basename: 'item-sales'
  });
});
