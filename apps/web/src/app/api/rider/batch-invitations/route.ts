/**
 * GET /api/rider/batch-invitations
 * The rider's currently-PENDING batch invitations. Most of the time there's
 * exactly one (the dispatcher creates them serially for a single rider), but
 * we always return a list to keep the client logic uniform.
 *
 * Stale (expired) rows are excluded server-side using `expiresAt > now()` so
 * a client that polls between expiry-sweeper ticks never sees a dead row.
 */
import { prisma } from '@/server/db';
import { BatchInvitationStatus } from '@prisma/client';
import { requireRider, serializeInvitation } from './_helpers';

export async function GET() {
  const guard = await requireRider();
  if (!guard.ok) return guard.response;

  const now = new Date();
  const rows = await prisma.batchInvitation.findMany({
    where: {
      riderId: guard.rider.profileId,
      status: BatchInvitationStatus.PENDING,
      expiresAt: { gt: now },
    },
    include: {
      order: {
        include: {
          branch: { select: { name: true } },
          address: { select: { line1: true, city: true } },
        },
      },
    },
    orderBy: { invitedAt: 'asc' },
  });

  return Response.json({
    invitations: rows.map((r) => serializeInvitation(r, now)),
  });
}
