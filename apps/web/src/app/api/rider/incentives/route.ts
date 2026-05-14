/**
 * GET /api/rider/incentives — active incentive slabs with this rider's live
 * progress for the current period.
 *
 * `deliveriesDone` is computed fresh from RiderAssignment rather than read off
 * RiderIncentiveProgress, so the count is always up to the minute even before
 * the background job stamps the progress row.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { countDeliveriesSince, startOfDay, startOfWeek } from '@/server/rider-payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const now = new Date();
  const incentives = await prisma.riderIncentive.findMany({
    where: {
      isActive: true,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
    },
    orderBy: { startsAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      period: true,
      targetDeliveries: true,
      bonusAmount: true,
    },
  });

  // Both period windows share a query each — compute once, reuse per incentive.
  const dailyDone = await countDeliveriesSince(profile.id, startOfDay(now));
  const weeklyDone = await countDeliveriesSince(profile.id, startOfWeek(now));

  return Response.json({
    incentives: incentives.map((inc) => {
      const deliveriesDone = inc.period === 'WEEKLY' ? weeklyDone : dailyDone;
      const target = inc.targetDeliveries;
      const achieved = deliveriesDone >= target;
      return {
        id: inc.id,
        title: inc.title,
        description: inc.description,
        period: inc.period,
        targetDeliveries: target,
        bonusAmount: Number(inc.bonusAmount),
        deliveriesDone,
        achieved,
        remaining: Math.max(0, target - deliveriesDone),
      };
    }),
  });
}
