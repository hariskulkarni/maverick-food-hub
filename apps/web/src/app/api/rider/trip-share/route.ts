/**
 * /api/rider/trip-share
 *
 * POST — start a shareable live-trip link. Any existing active share for the
 *        rider is deactivated first, then a fresh token is minted with a
 *        4-hour expiry. Returns `{ token, shareUrl, expiresAt }`.
 * GET  — the rider's active, non-expired share, or `{ share: null }`.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { genShareToken, buildShareUrl, TRIP_SHARE_TTL_MS, toTrimmedString } from '@/server/rider-safety';

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

  const share = await prisma.tripShare.findFirst({
    where: { riderId: profile.id, isActive: true, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });

  if (!share) return Response.json({ share: null });

  return Response.json({
    share: {
      token: share.token,
      shareUrl: buildShareUrl(share.token),
      expiresAt: share.expiresAt.toISOString(),
      assignmentId: share.assignmentId,
      createdAt: share.createdAt.toISOString(),
    },
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const assignmentId = toTrimmedString((body as Record<string, unknown>)?.assignmentId) ?? null;

  const expiresAt = new Date(Date.now() + TRIP_SHARE_TTL_MS);

  const share = await prisma.$transaction(async (tx) => {
    // Only one live share at a time — retire the rest.
    await tx.tripShare.updateMany({
      where: { riderId: profile.id, isActive: true },
      data: { isActive: false },
    });
    return tx.tripShare.create({
      data: {
        riderId: profile.id,
        assignmentId,
        token: genShareToken(),
        isActive: true,
        expiresAt,
      },
    });
  });

  return Response.json(
    {
      token: share.token,
      shareUrl: buildShareUrl(share.token),
      expiresAt: share.expiresAt.toISOString(),
    },
    { status: 201 }
  );
}
