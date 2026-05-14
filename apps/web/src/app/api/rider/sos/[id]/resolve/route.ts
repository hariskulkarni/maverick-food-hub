/**
 * POST /api/rider/sos/[id]/resolve
 *
 * Marks an SOS alert as RESOLVED ("I'm safe"). The alert must belong to the
 * authenticated rider; resolving an already-resolved alert is a no-op that
 * still returns the current row.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { toTrimmedString } from '@/server/rider-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(alert: {
  id: string;
  assignmentId: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  note: string | null;
  triggeredAt: Date;
  resolvedAt: Date | null;
  resolvedNote: string | null;
}) {
  return {
    id: alert.id,
    assignmentId: alert.assignmentId,
    lat: alert.lat,
    lng: alert.lng,
    status: alert.status,
    note: alert.note,
    triggeredAt: alert.triggeredAt.toISOString(),
    resolvedAt: alert.resolvedAt?.toISOString() ?? null,
    resolvedNote: alert.resolvedNote,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const { id } = await params;

  const alert = await prisma.sosAlert.findUnique({ where: { id } });
  if (!alert || alert.riderId !== profile.id) {
    return new Response('SOS alert not found', { status: 404 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const resolvedNote = toTrimmedString((body as Record<string, unknown>)?.resolvedNote) ?? null;

  // Already resolved / cancelled — return as-is rather than overwriting history.
  if (alert.status !== 'ACTIVE') {
    return Response.json({ alert: serialize(alert) });
  }

  const updated = await prisma.sosAlert.update({
    where: { id },
    data: {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      resolvedNote,
    },
  });

  return Response.json({ alert: serialize(updated) });
}
