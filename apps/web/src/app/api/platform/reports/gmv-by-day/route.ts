import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { parseRange, deliverReport } from '@/server/reports/range';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { from, to, format } = parseRange(new URL(req.url));

  const orders = await prisma.order.findMany({
    where: { placedAt: { gte: from, lte: to } },
    select: {
      placedAt: true,
      total: true,
      deliveryFee: true,
      status: true,
      branch: { select: { restaurant: { select: { commissionPct: true } } } },
      assignment: { select: { earningsAmt: true } }
    }
  });

  const ignored = new Set(['CANCELLED', 'PAYMENT_FAILED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN']);
  const buckets = new Map<string, { orders: number; gmv: number; commission: number; deliveryFees: number; riderPayouts: number }>();
  for (const o of orders) {
    if (ignored.has(o.status)) continue;
    const day = o.placedAt.toISOString().slice(0, 10);
    const b = buckets.get(day) ?? { orders: 0, gmv: 0, commission: 0, deliveryFees: 0, riderPayouts: 0 };
    const gmv = Number(o.total);
    const commissionPct = o.branch.restaurant.commissionPct ?? 0;
    b.orders += 1;
    b.gmv += gmv;
    b.commission += +(gmv * commissionPct / 100).toFixed(2);
    b.deliveryFees += Number(o.deliveryFee);
    b.riderPayouts += Number(o.assignment?.earningsAmt ?? 0);
    buckets.set(day, b);
  }

  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => [day, b.orders, b.gmv.toFixed(2), b.commission.toFixed(2), b.deliveryFees.toFixed(2), b.riderPayouts.toFixed(2)]);

  return deliverReport({
    format,
    headers: ['date', 'orders', 'gmv', 'commission', 'deliveryFees', 'riderPayouts'],
    rows,
    basename: 'gmv-by-day'
  });
}
