/**
 * /api/rider/preferences
 *
 * GET   — the rider's dispatch preferences. The row is created with defaults
 *         (via upsert) the first time it's read, so the app always gets a row.
 * PATCH — update any subset of { autoAccept, maxBatchSize, notifyRadiusKm,
 *         preferredZones, breakMode, breakUntil }. Setting breakMode=true with a
 *         breakUntil stores it; setting breakMode=false clears breakUntil.
 *
 * One RiderPreferences row per rider (riderId is @unique).
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(p: {
  autoAccept: boolean;
  maxBatchSize: number;
  notifyRadiusKm: number;
  preferredZones: string[];
  breakMode: boolean;
  breakUntil: Date | null;
  updatedAt: Date;
}) {
  return {
    autoAccept: p.autoAccept,
    maxBatchSize: p.maxBatchSize,
    notifyRadiusKm: p.notifyRadiusKm,
    preferredZones: p.preferredZones,
    breakMode: p.breakMode,
    breakUntil: p.breakUntil ? p.breakUntil.toISOString() : null,
    updatedAt: p.updatedAt.toISOString(),
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

  const prefs = await prisma.riderPreferences.upsert({
    where: { riderId: profile.id },
    update: {},
    create: { riderId: profile.id },
  });

  return Response.json({ preferences: serialize(prefs) });
}

export async function PATCH(req: Request) {
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

  const data: {
    autoAccept?: boolean;
    maxBatchSize?: number;
    notifyRadiusKm?: number;
    preferredZones?: string[];
    breakMode?: boolean;
    breakUntil?: Date | null;
  } = {};

  if (b.autoAccept !== undefined) {
    data.autoAccept = b.autoAccept === true;
  }

  if (b.maxBatchSize !== undefined) {
    const n = Number(b.maxBatchSize);
    if (!Number.isInteger(n) || n < 1 || n > 3) {
      return Response.json({ error: 'maxBatchSize must be an integer 1–3.' }, { status: 400 });
    }
    data.maxBatchSize = n;
  }

  if (b.notifyRadiusKm !== undefined) {
    const n = Number(b.notifyRadiusKm);
    if (!Number.isFinite(n) || n <= 0 || n > 25) {
      return Response.json(
        { error: 'notifyRadiusKm must be a number between 0 and 25.' },
        { status: 400 }
      );
    }
    data.notifyRadiusKm = n;
  }

  if (b.preferredZones !== undefined) {
    if (!Array.isArray(b.preferredZones)) {
      return Response.json({ error: 'preferredZones must be an array.' }, { status: 400 });
    }
    data.preferredZones = b.preferredZones
      .filter((z): z is string => typeof z === 'string')
      .map((z) => z.trim())
      .filter((z) => z.length > 0);
  }

  // Break mode: when turned on we keep the supplied breakUntil; when turned off
  // we always clear breakUntil so a stale timestamp can't linger.
  if (b.breakMode !== undefined) {
    const on = b.breakMode === true;
    data.breakMode = on;
    if (on) {
      if (b.breakUntil !== undefined && b.breakUntil !== null) {
        const until = new Date(b.breakUntil as string);
        if (Number.isNaN(until.getTime())) {
          return Response.json({ error: 'breakUntil is not a valid date.' }, { status: 400 });
        }
        data.breakUntil = until;
      }
    } else {
      data.breakUntil = null;
    }
  } else if (b.breakUntil !== undefined) {
    // breakUntil supplied without a breakMode change — accept it as-is.
    if (b.breakUntil === null) {
      data.breakUntil = null;
    } else {
      const until = new Date(b.breakUntil as string);
      if (Number.isNaN(until.getTime())) {
        return Response.json({ error: 'breakUntil is not a valid date.' }, { status: 400 });
      }
      data.breakUntil = until;
    }
  }

  const prefs = await prisma.riderPreferences.upsert({
    where: { riderId: profile.id },
    update: data,
    create: { riderId: profile.id, ...data },
  });

  return Response.json({ preferences: serialize(prefs) });
}
