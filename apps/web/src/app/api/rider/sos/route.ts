/**
 * /api/rider/sos
 *
 * POST — trigger an SOS panic alert. Captures the rider's location (if sent)
 *        and creates an ACTIVE SosAlert. Idempotent: if the rider already has
 *        an ACTIVE alert, the existing one is returned instead of a duplicate.
 * GET  — the rider's currently ACTIVE alert, or `{ active: null }`.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { toFiniteNumber, toTrimmedString } from '@/server/rider-safety';

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

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const active = await prisma.sosAlert.findFirst({
    where: { riderId: profile.id, status: 'ACTIVE' },
    orderBy: { triggeredAt: 'desc' },
  });

  return Response.json({ active: active ? serialize(active) : null });
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
  const b = (body ?? {}) as Record<string, unknown>;

  // Don't stack duplicate panic alerts — return the one that's already live.
  const existing = await prisma.sosAlert.findFirst({
    where: { riderId: profile.id, status: 'ACTIVE' },
    orderBy: { triggeredAt: 'desc' },
  });
  if (existing) {
    return Response.json({ alert: serialize(existing), alreadyActive: true });
  }

  const alert = await prisma.sosAlert.create({
    data: {
      riderId: profile.id,
      assignmentId: toTrimmedString(b.assignmentId) ?? null,
      lat: toFiniteNumber(b.lat) ?? null,
      lng: toFiniteNumber(b.lng) ?? null,
      note: toTrimmedString(b.note) ?? null,
      status: 'ACTIVE',
    },
  });

  return Response.json({ alert: serialize(alert), alreadyActive: false }, { status: 201 });
}
