import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { parseRange, deliverReport } from '@/server/reports/range';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const { from, to, format } = parseRange(new URL(req.url));

  const cods = await prisma.codCollection.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: {
      riderId: true,
      amountToCollect: true,
      amountCollected: true,
      status: true,
      createdAt: true,
      rider: { select: { user: { select: { name: true, phone: true } } } }
    }
  });

  const agg = new Map<string, {
    name: string;
    pending: number;
    collected: number;
    mismatches: number;
    oldestPending: Date | null;
  }>();

  const now = Date.now();
  for (const c of cods) {
    const id = c.riderId;
    const row = agg.get(id) ?? {
      name: c.rider.user.name ?? c.rider.user.phone ?? id,
      pending: 0, collected: 0, mismatches: 0, oldestPending: null
    };
    if (c.status === 'COLLECTED' || c.status === 'RECONCILED') {
      row.collected += Number(c.amountCollected ?? c.amountToCollect);
    } else if (c.status === 'MISMATCH' || c.status === 'PARTIAL_COLLECTED') {
      row.mismatches += 1;
      row.collected += Number(c.amountCollected ?? 0);
    } else if (c.status === 'PENDING_COLLECTION' || c.status === 'DEPOSIT_PENDING') {
      row.pending += Number(c.amountToCollect) - Number(c.amountCollected ?? 0);
      if (!row.oldestPending || c.createdAt < row.oldestPending) row.oldestPending = c.createdAt;
    }
    agg.set(id, row);
  }

  const rows = Array.from(agg.entries())
    .sort(([, a], [, b]) => b.pending - a.pending)
    .map(([riderId, r]) => {
      const oldestDays = r.oldestPending
        ? Math.floor((now - r.oldestPending.getTime()) / 86_400_000)
        : 0;
      return [riderId, r.name, r.pending.toFixed(2), r.collected.toFixed(2), r.mismatches, oldestDays];
    });

  return deliverReport({
    format,
    headers: ['riderId', 'name', 'pending', 'collected', 'mismatches', 'oldestPendingDays'],
    rows,
    basename: 'cod-pending'
  });
}
