/**
 * /api/rider/emergency-contacts/[id]
 *
 * PATCH  — update a contact (name / phone / relation / isPrimary). Setting
 *          `isPrimary` demotes any other primary so there is at most one.
 * DELETE — remove a contact.
 *
 * Both verify ownership (contact.riderId === profile.id) and 404 otherwise.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { toTrimmedString } from '@/server/rider-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(c: {
  id: string;
  name: string;
  phone: string;
  relation: string | null;
  isPrimary: boolean;
  createdAt: Date;
}) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    relation: c.relation,
    isPrimary: c.isPrimary,
    createdAt: c.createdAt.toISOString(),
  };
}

async function resolveOwnedContact(userId: string, contactId: string) {
  const profile = await prisma.riderProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!profile) return { error: new Response('No rider profile', { status: 404 }) };

  const contact = await prisma.riderEmergencyContact.findUnique({ where: { id: contactId } });
  if (!contact || contact.riderId !== profile.id) {
    return { error: new Response('Contact not found', { status: 404 }) };
  }
  return { profileId: profile.id, contact };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const { id } = await params;
  const owned = await resolveOwnedContact(session.user.id, id);
  if ('error' in owned) return owned.error;
  const { profileId } = owned;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const data: {
    name?: string;
    phone?: string;
    relation?: string | null;
    isPrimary?: boolean;
  } = {};

  if (b.name !== undefined) {
    const name = toTrimmedString(b.name);
    if (!name) return Response.json({ error: 'Name cannot be empty.' }, { status: 400 });
    data.name = name;
  }
  if (b.phone !== undefined) {
    const phone = toTrimmedString(b.phone);
    if (!phone) return Response.json({ error: 'Phone number cannot be empty.' }, { status: 400 });
    data.phone = phone;
  }
  if (b.relation !== undefined) {
    data.relation = toTrimmedString(b.relation) ?? null;
  }
  if (b.isPrimary !== undefined) {
    data.isPrimary = b.isPrimary === true;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (data.isPrimary === true) {
      await tx.riderEmergencyContact.updateMany({
        where: { riderId: profileId, isPrimary: true, NOT: { id } },
        data: { isPrimary: false },
      });
    }
    return tx.riderEmergencyContact.update({ where: { id }, data });
  });

  return Response.json({ contact: serialize(updated) });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const { id } = await params;
  const owned = await resolveOwnedContact(session.user.id, id);
  if ('error' in owned) return owned.error;

  await prisma.riderEmergencyContact.delete({ where: { id } });

  return Response.json({ ok: true });
}
