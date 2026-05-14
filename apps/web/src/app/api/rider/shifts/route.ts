/**
 * /api/rider/shifts
 *
 * GET  — this rider's shifts from today onward, soonest first.
 * POST — book a new shift slot. Body: { date, startTime, endTime, zoneName? }.
 *        The date must not be in the past and endTime must be after startTime.
 *
 * `startTime` / `endTime` are "HH:MM" local strings; `date` is a calendar date
 * stored in a `@db.Date` column.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Matches a 24-hour "HH:MM" time string. */
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function serialize(s: {
  id: string;
  date: Date;
  startTime: string;
  endTime: string;
  zoneName: string | null;
  status: string;
}) {
  return {
    id: s.id,
    date: s.date.toISOString(),
    startTime: s.startTime,
    endTime: s.endTime,
    zoneName: s.zoneName,
    status: s.status,
  };
}

/** Parse a "YYYY-MM-DD" string into a UTC-midnight Date, or null if invalid. */
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const d = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  // Compare against UTC midnight today so a shift booked for "today" still shows.
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const shifts = await prisma.riderShift.findMany({
    where: { riderId: profile.id, date: { gte: todayUtc } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

  return Response.json({ shifts: shifts.map(serialize) });
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

  const date = parseDateOnly(b.date);
  if (!date) {
    return Response.json({ error: 'A valid date (YYYY-MM-DD) is required.' }, { status: 400 });
  }

  const startTime = typeof b.startTime === 'string' ? b.startTime.trim() : '';
  const endTime = typeof b.endTime === 'string' ? b.endTime.trim() : '';
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
    return Response.json({ error: 'startTime and endTime must be "HH:MM".' }, { status: 400 });
  }
  if (endTime <= startTime) {
    return Response.json({ error: 'End time must be after start time.' }, { status: 400 });
  }

  // Reject dates before today (UTC-midnight comparison).
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  if (date.getTime() < todayUtc.getTime()) {
    return Response.json({ error: 'Cannot book a shift in the past.' }, { status: 400 });
  }

  const zoneName =
    typeof b.zoneName === 'string' && b.zoneName.trim() ? b.zoneName.trim() : null;

  const shift = await prisma.riderShift.create({
    data: {
      riderId: profile.id,
      date,
      startTime,
      endTime,
      zoneName,
      status: 'BOOKED',
    },
  });

  return Response.json({ shift: serialize(shift) }, { status: 201 });
}
