/**
 * /api/rider/emergency-contacts
 *
 * GET  — the rider's emergency contacts, primary first.
 * POST — add a contact. If `isPrimary` is set, any existing primary contact is
 *        demoted first so there is at most one primary per rider.
 */
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

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const contacts = await prisma.riderEmergencyContact.findMany({
    where: { riderId: profile.id },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
  });

  return Response.json({ contacts: contacts.map(serialize) });
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

  const name = toTrimmedString(b.name);
  const phone = toTrimmedString(b.phone);
  if (!name) return Response.json({ error: 'Name is required.' }, { status: 400 });
  if (!phone) return Response.json({ error: 'Phone number is required.' }, { status: 400 });

  const relation = toTrimmedString(b.relation) ?? null;
  const isPrimary = b.isPrimary === true;

  const contact = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.riderEmergencyContact.updateMany({
        where: { riderId: profile.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.riderEmergencyContact.create({
      data: { riderId: profile.id, name, phone, relation, isPrimary },
    });
  });

  return Response.json({ contact: serialize(contact) }, { status: 201 });
}
