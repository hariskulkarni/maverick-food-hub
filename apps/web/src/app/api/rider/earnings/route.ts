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

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todays = recent.filter((r) => r.deliveredAt && r.deliveredAt >= startOfToday);

  return Response.json({
    lifetime: {
      totalEarnings: Number(profile.totalEarnings),
      totalTips: Number(profile.totalTips),
      totalDeliveries: profile.totalDeliveries,
      rating: profile.rating,
    },
    today: {
      earnings: todays.reduce((s, r) => s + Number(r.earningsAmt), 0),
      deliveries: todays.length,
    },
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
