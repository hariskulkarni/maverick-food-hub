/**
 * GET /api/rider/earnings
 *
 * JSON earnings summary for the native app's Earnings tab — lifetime totals
 * from RiderProfile plus today's tally and the most recent delivered runs.
 * (The CSV/XLSX statement lives at /api/rider/reports/statement; this is the
 * lightweight in-app view.)
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { getRiderEarningsGoals } from '@/server/platform-settings';
import { istDayKey, istStartOfDay, istStartOfWeek } from '@/lib/ist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      totalEarnings: true,
      totalTips: true,
      totalDeliveries: true,
      rating: true,
    },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const recent = await prisma.riderAssignment.findMany({
    where: { riderId: profile.id, status: 'DELIVERED' },
    orderBy: { deliveredAt: 'desc' },
    take: 20,
    select: {
      id: true,
      deliveredAt: true,
      earningsAmt: true,
      baseEarningsAmt: true,
      tipAmt: true,
      order: { select: { code: true } },
    },
  });

  // P2-17 / P1-16: today / this week are IST periods computed with aggregate
  // queries (not from the last 20 rows), and goals come from platform config.
  const now = new Date();
  const todayStart = istStartOfDay(now);
  const weekStart = istStartOfWeek(now);
  const sevenDaysStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const delivered = { riderId: profile.id, status: 'DELIVERED' as const };
  const [todayAgg, weekAgg, lastSeven, goals] = await Promise.all([
    prisma.riderAssignment.aggregate({ where: { ...delivered, deliveredAt: { gte: todayStart } }, _sum: { earningsAmt: true }, _count: { _all: true } }),
    prisma.riderAssignment.aggregate({ where: { ...delivered, deliveredAt: { gte: weekStart } }, _sum: { earningsAmt: true }, _count: { _all: true } }),
    prisma.riderAssignment.findMany({ where: { ...delivered, deliveredAt: { gte: sevenDaysStart } }, select: { deliveredAt: true, earningsAmt: true } }),
    getRiderEarningsGoals(),
  ]);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysStart.getTime() + i * 24 * 60 * 60 * 1000);
    return { date: istDayKey(d), earnings: 0, deliveries: 0 };
  });
  for (const r of lastSeven) {
    if (!r.deliveredAt) continue;
    const day = days.find((x) => x.date === istDayKey(r.deliveredAt!));
    if (day) {
      day.earnings = Math.round((day.earnings + Number(r.earningsAmt)) * 100) / 100;
      day.deliveries += 1;
    }
  }

  return Response.json({
    lifetime: {
      totalEarnings: Number(profile.totalEarnings),
      totalTips: Number(profile.totalTips),
      totalDeliveries: profile.totalDeliveries,
      rating: profile.rating,
    },
    today: { earnings: Number(todayAgg._sum.earningsAmt ?? 0), deliveries: todayAgg._count._all },
    week: { earnings: Number(weekAgg._sum.earningsAmt ?? 0), deliveries: weekAgg._count._all },
    goals,
    last7Days: days,
    recent: recent.map((r) => ({
      id: r.id,
      orderCode: r.order.code,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      earnings: Number(r.earningsAmt),
      base: Number(r.baseEarningsAmt),
      tip: Number(r.tipAmt),
    })),
  });
}
