/**
 * GET /api/rider/surge — currently-live surge zones.
 *
 * A zone is "live" when isActive is true and — if it has an activeFrom/activeTo
 * window — now falls inside it. Sorted hottest-first (highest multiplier).
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
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const now = new Date();
  const zones = await prisma.surgeZone.findMany({
    where: {
      isActive: true,
      OR: [{ activeFrom: null }, { activeFrom: { lte: now } }],
      AND: [{ OR: [{ activeTo: null }, { activeTo: { gte: now } }] }],
    },
    orderBy: { multiplier: 'desc' },
    select: {
      id: true,
      name: true,
      label: true,
      centerLat: true,
      centerLng: true,
      radiusKm: true,
      multiplier: true,
    },
  });

  return Response.json({
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      label: z.label,
      centerLat: z.centerLat,
      centerLng: z.centerLng,
      radiusKm: z.radiusKm,
      multiplier: z.multiplier,
    })),
  });
}
