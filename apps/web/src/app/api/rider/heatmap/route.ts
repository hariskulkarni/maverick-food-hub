/**
 * GET /api/rider/heatmap
 *
 * The live demand heatmap for the rider app's "Demand Map" screen. Returns one
 * point per pickup branch that currently has open (READY, unassigned) orders,
 * each tagged with a coarse intensity band so the app can size/colour it.
 * Points are sorted busiest-first.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { getDemandPoints, intensityForCount } from '@/server/rider-dispatch';

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

  const points = await getDemandPoints();

  return Response.json({
    points: points.map((p) => ({
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      count: p.count,
      intensity: intensityForCount(p.count),
    })),
    totalOpen: points.reduce((sum, p) => sum + p.count, 0),
    generatedAt: new Date().toISOString(),
  });
}
