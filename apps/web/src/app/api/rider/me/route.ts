/**
 * GET /api/rider/me
 *
 * Lightweight self-status endpoint for the rider account sheet. Returns the
 * online flag and the last heartbeat timestamp so the UI can show a fresh
 * "Last GPS ping: 12s ago" without polling the heartbeat write endpoint.
 *
 * Also returns the rider's sourcing identity — `riderType` and, for DEDICATED
 * riders, the restaurant they belong to — so the native app can show whether
 * the rider is on the fleet or dedicated to a specific restaurant.
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
      isOnline: true,
      riderType: true,
      // Pull the dedicated restaurant (if any) so we can echo {id,name}.
      dedicatedRestaurant: { select: { id: true, name: true } },
      // Profile photo lives on the User row.
      user: { select: { avatarUrl: true } }
    }
  });
  if (!profile) {
    // No profile yet — default to a FLEET shape so the native app always gets
    // a consistent object.
    return Response.json({
      online: false,
      lastSeenAt: null,
      riderType: 'FLEET',
      dedicatedRestaurant: null,
      avatarUrl: null
    });
  }
  const hb = await prisma.riderHeartbeat.findUnique({
    where: { riderId: profile.id },
    select: { lastSeenAt: true }
  });
  return Response.json({
    online: profile.isOnline,
    lastSeenAt: hb?.lastSeenAt?.toISOString() ?? null,
    riderType: profile.riderType,
    dedicatedRestaurant: profile.dedicatedRestaurant
      ? { id: profile.dedicatedRestaurant.id, name: profile.dedicatedRestaurant.name }
      : null,
    avatarUrl: profile.user?.avatarUrl ?? null
  });
}
