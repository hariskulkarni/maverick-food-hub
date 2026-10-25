/**
 * GET /api/customer/me  (PATCH below edits name / email)
 *
 * Returns the signed-in customer's basic profile bundle.
 * Used by the tenant-scoped "My account" page (and any future header avatar
 * surface) to fetch a small, stable shape independently of the slug-scoped
 * bundle in /api/customer/me/[slug].
 *
 * Auth: any signed-in user. We don't gate by role here — staff also have a
 * user record and may want to see their own profile — but the customer
 * dashboard page itself does enforce role=CUSTOMER.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, phone: true, email: true, avatarUrl: true, role: true, createdAt: true }
  });

  if (!user) return new Response('Not found', { status: 404 });

  return Response.json({ user });
}

/**
 * PATCH /api/customer/me  { name?, email? } — the signed-in CUSTOMER edits
 * their own name / email. Email is lower-cased, must be unique ('' clears it).
 * Staff / platform accounts are refused: their email is a login identifier
 * and is changed by a super admin. Audited (which fields changed, no values).
 */
const PatchBody = z
  .object({
    name: z.string().trim().min(1, 'Name cannot be empty.').max(80).optional(),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email.').max(160)]).optional(),
  })
  .refine((b) => b.name !== undefined || b.email !== undefined, { message: 'Nothing to update.' });

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
  if (session.user.role !== 'CUSTOMER') {
    return Response.json({ error: 'Staff accounts are updated by a platform super admin.' }, { status: 403 });
  }
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' }, { status: 400 });
  }
  const data: { name?: string; email?: string | null } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.email !== undefined) data.email = parsed.data.email === '' ? null : parsed.data.email;

  if (data.email) {
    const taken = await prisma.user.findFirst({
      where: { email: { equals: data.email, mode: 'insensitive' }, id: { not: session.user.id } },
      select: { id: true },
    });
    if (taken) return Response.json({ error: 'That email is already used by another account.' }, { status: 409 });
  }

  let user;
  try {
    user = await prisma.user.update({
      where: { id: session.user.id },
      data,
      select: { id: true, name: true, email: true, phone: true },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      return Response.json({ error: 'That email is already used by another account.' }, { status: 409 });
    }
    throw e;
  }
  await audit('user.profile.update', {
    actorId: session.user.id, actorRole: session.user.role, entityType: 'User', entityId: session.user.id,
    after: { fields: Object.keys(data) },
  }).catch(() => {});
  return Response.json({ ok: true, user });
}
