/**
 * GET /api/rider/me
 *
 * Lightweight self-status endpoint for the rider account sheet. Returns the
 * online flag and the last heartbeat timestamp so the UI can show a fresh
 * "Last GPS ping: 12s ago" without polling the heartbeat write endpoint.
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
    select: { id: true, isOnline: true }
  });
  if (!profile) return Response.json({ online: false, lastSeenAt: null });
  const hb = await prisma.riderHeartbeat.findUnique({
    where: { riderId: profile.id },
    select: { lastSeenAt: true }
  });
  return Response.json({
    online: profile.isOnline,
    lastSeenAt: hb?.lastSeenAt?.toISOString() ?? null
  });
}
