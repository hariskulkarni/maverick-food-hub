import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { parseRange, deliverReport } from '@/server/reports/range';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  const profile = await prisma.riderProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const { from, to, format } = parseRange(new URL(req.url));

  const assignments = await prisma.riderAssignment.findMany({
    where: {
      riderId: profile.id,
      status: 'DELIVERED',
      deliveredAt: { gte: from, lte: to }
    },
    orderBy: { deliveredAt: 'desc' },
    select: {
      deliveredAt: true,
      baseEarningsAmt: true,
      bonusAmt: true,
      tipAmt: true,
      earningsAmt: true,
      order: {
        select: {
          code: true,
          codCollection: { select: { amountCollected: true, amountToCollect: true, status: true } }
        }
      }
    }
  });

  const rows = assignments.map((a) => {
    const cod = a.order.codCollection;
    const codCollected = cod && (cod.status === 'COLLECTED' || cod.status === 'RECONCILED' || cod.status === 'PARTIAL_COLLECTED')
      ? Number(cod.amountCollected ?? cod.amountToCollect)
      : 0;
    return [
      a.order.code,
      a.deliveredAt?.toISOString() ?? '',
      Number(a.baseEarningsAmt).toFixed(2),
      Number(a.bonusAmt).toFixed(2),
      Number(a.tipAmt).toFixed(2),
      Number(a.earningsAmt).toFixed(2),
      codCollected.toFixed(2)
    ];
  });

  return deliverReport({
    format,
    headers: ['orderCode', 'deliveredAt', 'base', 'bonus', 'tip', 'total', 'codCollected'],
    rows,
    basename: 'rider-statement'
  });
}
