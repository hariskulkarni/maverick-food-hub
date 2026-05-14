import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { parseRange, deliverReport } from '@/server/reports/range';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { from, to, format } = parseRange(new URL(req.url));

  const assignments = await prisma.riderAssignment.findMany({
    where: {
      status: 'DELIVERED',
      deliveredAt: { gte: from, lte: to }
    },
    select: {
      riderId: true,
      baseEarningsAmt: true,
      bonusAmt: true,
      tipAmt: true,
      earningsAmt: true,
      rider: { select: { user: { select: { name: true, phone: true } } } }
    }
  });

  const agg = new Map<string, { name: string; trips: number; base: number; bonus: number; tip: number; total: number }>();
  for (const a of assignments) {
    const id = a.riderId;
    const row = agg.get(id) ?? {
      name: a.rider.user.name ?? a.rider.user.phone ?? id,
      trips: 0, base: 0, bonus: 0, tip: 0, total: 0
    };
    row.trips += 1;
    row.base += Number(a.baseEarningsAmt);
    row.bonus += Number(a.bonusAmt);
    row.tip += Number(a.tipAmt);
    row.total += Number(a.earningsAmt);
    agg.set(id, row);
  }

  const rows = Array.from(agg.entries())
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([riderId, r]) => [riderId, r.name, r.trips, r.base.toFixed(2), r.bonus.toFixed(2), r.tip.toFixed(2), r.total.toFixed(2)]);

  return deliverReport({
    format,
    headers: ['riderId', 'name', 'trips', 'base', 'bonus', 'tips', 'total'],
    rows,
    basename: 'rider-earnings'
  });
}
