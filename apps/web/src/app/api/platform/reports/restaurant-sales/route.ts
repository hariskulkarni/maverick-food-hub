import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { parseRange, deliverReport } from '@/server/reports/range';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { from, to, format } = parseRange(new URL(req.url));

  const restaurants = await prisma.restaurant.findMany({
    select: {
      id: true,
      name: true,
      commissionPct: true,
      branches: { select: { id: true } }
    }
  });

  const rows: unknown[][] = [];
  for (const r of restaurants) {
    const branchIds = r.branches.map((b) => b.id);
    if (branchIds.length === 0) {
      rows.push([r.id, r.name, 0, '0.00', '0.00', 0]);
      continue;
    }
    const [agg, refunds] = await Promise.all([
      prisma.order.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: {
          branchId: { in: branchIds },
          placedAt: { gte: from, lte: to },
          status: { notIn: ['CANCELLED', 'PAYMENT_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN'] }
        }
      }),
      prisma.refund.count({
        where: {
          createdAt: { gte: from, lte: to },
          order: { branchId: { in: branchIds } }
        }
      })
    ]);
    const gmv = Number(agg._sum.total ?? 0);
    const commission = +(gmv * (r.commissionPct ?? 0) / 100).toFixed(2);
    rows.push([r.id, r.name, agg._count._all, gmv.toFixed(2), commission.toFixed(2), refunds]);
  }

  rows.sort((a, b) => Number(b[3]) - Number(a[3]));

  return deliverReport({
    format,
    headers: ['restaurantId', 'name', 'orders', 'gmv', 'commissionEarned', 'refundsCount'],
    rows,
    basename: 'restaurant-sales'
  });
}
