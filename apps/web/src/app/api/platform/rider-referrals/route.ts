/**
 * GET /api/platform/rider-referrals — every refer-a-rider record, joined to the
 * referrer's name/phone, plus per-status rollups (count + total bonus paid on
 * REWARDED). Optional ?status filter.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireSuperAdmin();
  const status = new URL(req.url).searchParams.get('status') || undefined;

  const where: any = {};
  if (status) where.status = status;

  const [referrals, byStatus, rewardedAgg] = await Promise.all([
    prisma.riderReferral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { referrer: { include: { user: { select: { name: true, phone: true } } } } }
    }),
    prisma.riderReferral.groupBy({ by: ['status'], _count: { _all: true }, _sum: { bonusAmount: true } }),
    prisma.riderReferral.aggregate({ where: { status: 'REWARDED' }, _sum: { bonusAmount: true }, _count: { _all: true } })
  ]);

  return Response.json({
    referrals: referrals.map((r) => ({
      id: r.id,
      referrerId: r.referrerId,
      code: r.code,
      refereePhone: r.refereePhone,
      refereeName: r.refereeName,
      status: r.status,
      bonusAmount: Number(r.bonusAmount),
      createdAt: r.createdAt,
      qualifiedAt: r.qualifiedAt,
      rewardedAt: r.rewardedAt,
      referrer: { name: r.referrer.user.name, phone: r.referrer.user.phone }
    })),
    byStatus: byStatus.map((s) => ({
      status: s.status,
      count: s._count._all,
      totalBonus: Number(s._sum.bonusAmount ?? 0)
    })),
    rewardedTotals: {
      count: rewardedAgg._count._all,
      totalBonus: Number(rewardedAgg._sum.bonusAmount ?? 0)
    }
  });
}
