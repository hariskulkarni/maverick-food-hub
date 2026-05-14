/**
 * /api/rider/shifts/[id]
 *
 * PATCH  — advance a shift's lifecycle. Allowed transitions:
 *            BOOKED  → STARTED | CANCELLED
 *            STARTED → COMPLETED | CANCELLED
 *          Anything else is a 409.
 * DELETE — drop a shift, only while it is still BOOKED (409 otherwise).
 *
 * Both verify ownership (shift.riderId === profile.id) → 404 if it isn't this
 * rider's shift.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { ShiftStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Legal status transitions a rider may drive from the app. */
const TRANSITIONS: Record<string, ShiftStatus[]> = {
  BOOKED: [ShiftStatus.STARTED, ShiftStatus.CANCELLED],
  STARTED: [ShiftStatus.COMPLETED, ShiftStatus.CANCELLED],
  COMPLETED: [],
  MISSED: [],
  CANCELLED: [],
};

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

async function resolveOwnedShift(userId: string, shiftId: string) {
  const profile = await prisma.riderProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) return { error: new Response('No rider profile', { status: 404 }) };

  const shift = await prisma.riderShift.findUnique({ where: { id: shiftId } });
  if (!shift || shift.riderId !== profile.id) {
    return { error: new Response('Shift not found', { status: 404 }) };
  }
  return { shift };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const { id } = await params;
  const owned = await resolveOwnedShift(session.user.id, id);
  if ('error' in owned) return owned.error;
  const { shift } = owned;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const next = (body as Record<string, unknown>)?.status;

  if (typeof next !== 'string' || !(next in ShiftStatus)) {
    return Response.json({ error: 'A valid status is required.' }, { status: 400 });
  }
  const target = next as ShiftStatus;

  const allowed = TRANSITIONS[shift.status] ?? [];
  if (!allowed.includes(target)) {
    return Response.json(
      { error: `Cannot move a ${shift.status} shift to ${target}.` },
      { status: 409 }
    );
  }

  const updated = await prisma.riderShift.update({
    where: { id },
    data: { status: target },
  });

  return Response.json({ shift: serialize(updated) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const { id } = await params;
  const owned = await resolveOwnedShift(session.user.id, id);
  if ('error' in owned) return owned.error;
  const { shift } = owned;

  if (shift.status !== ShiftStatus.BOOKED) {
    return Response.json(
      { error: 'Only a booked shift can be deleted. Cancel it instead.' },
      { status: 409 }
    );
  }

  await prisma.riderShift.delete({ where: { id } });

  return Response.json({ ok: true });
}
