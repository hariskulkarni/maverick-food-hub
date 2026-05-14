/**
 * GET /api/rider/tier
 *
 * The rider's loyalty-ladder standing for the native app's "My Tier" screen.
 * Loads lifetime stats from RiderProfile and runs them through `computeTier`
 * — returning the current rung, the next rung, progress toward it, perks, and
 * the full ladder, plus the raw stats the UI shows alongside.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { computeTier } from '@/server/rider-growth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { totalDeliveries: true, rating: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const tier = computeTier({
    totalDeliveries: profile.totalDeliveries,
    rating: profile.rating,
  });

  return Response.json({
    ...tier,
    stats: {
      totalDeliveries: profile.totalDeliveries,
      rating: profile.rating,
    },
  });
}
