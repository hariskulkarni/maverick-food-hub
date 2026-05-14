/**
 * /api/rider/incidents
 *
 * GET  — the rider's incident reports, newest first.
 * POST — file a new incident report (status OPEN). Type is validated against
 *        the IncidentType enum; location + photo are optional.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { isIncidentType, toFiniteNumber, toTrimmedString } from '@/server/rider-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(r: {
  id: string;
  assignmentId: string | null;
  type: string;
  status: string;
  description: string;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    assignmentId: r.assignmentId,
    type: r.type,
    status: r.status,
    description: r.description,
    lat: r.lat,
    lng: r.lng,
    photoUrl: r.photoUrl,
    resolution: r.resolution,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
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

  const incidents = await prisma.riderIncidentReport.findMany({
    where: { riderId: profile.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return Response.json({ incidents: incidents.map(serialize) });
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

  if (!isIncidentType(b.type)) {
    return Response.json({ error: 'A valid incident type is required.' }, { status: 400 });
  }
  const description = toTrimmedString(b.description);
  if (!description) {
    return Response.json({ error: 'A description is required.' }, { status: 400 });
  }

  const incident = await prisma.riderIncidentReport.create({
    data: {
      riderId: profile.id,
      type: b.type,
      status: 'OPEN',
      description,
      lat: toFiniteNumber(b.lat) ?? null,
      lng: toFiniteNumber(b.lng) ?? null,
      assignmentId: toTrimmedString(b.assignmentId) ?? null,
      photoUrl: toTrimmedString(b.photoUrl) ?? null,
    },
  });

  return Response.json({ incident: serialize(incident) }, { status: 201 });
}
