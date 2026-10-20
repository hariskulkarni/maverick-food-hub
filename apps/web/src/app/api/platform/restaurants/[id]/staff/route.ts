/**
 * POST /api/platform/restaurants/[id]/staff — SUPER_ADMIN only.
 *
 * Adds a staff account (ADMIN or KITCHEN) with an initial password to an
 * EXISTING restaurant. Mirrors the wizard's staff creation (User +
 * RestaurantUser in one transaction). An email that already belongs to a user
 * is rejected with 409 — we never silently attach an existing account.
 * The password / hash is never returned, logged or written to the audit trail.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import argon2 from 'argon2';
import { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { clientIp } from '@/server/http/rate-limit';

export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(12).max(200),
  role: z.enum(['ADMIN', 'KITCHEN'])
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const { id: restaurantId } = await params;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'invalid';
    return Response.json({ error: 'invalid_body', detail }, { status: 400 });
  }

  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
  if (!restaurant) return Response.json({ error: 'not_found', message: 'Restaurant not found.' }, { status: 404 });

  const email = body.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return Response.json(
      { error: 'email_taken', message: 'A user with that email already exists. Use a different email.' },
      { status: 409 }
    );
  }

  const role = Role[body.role];
  const passwordHash = await argon2.hash(body.password);

  let created: { id: string; email: string | null; role: Role };
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name: body.name.trim(), passwordHash, role },
        select: { id: true, email: true, role: true }
      });
      await tx.restaurantUser.create({ data: { restaurantId, userId: user.id, role } });
      return user;
    });
  } catch (e: any) {
    // Race on the unique email / membership constraint.
    if (e?.code === 'P2002') {
      return Response.json({ error: 'email_taken', message: 'A user with that email already exists.' }, { status: 409 });
    }
    throw e;
  }

  await audit('platform.restaurant.staff.create', {
    actorId: session.user.id,
    actorRole: session.user.role,
    restaurantId,
    entityType: 'User',
    entityId: created.id,
    after: { email: created.email, role: created.role },
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent')
  }).catch(() => {});

  return Response.json({ ok: true, user: { id: created.id, email: created.email, role: created.role } }, { status: 201 });
}
