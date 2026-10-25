/**
 * ─────────────────────────────────────────────────────────────────────────
 *  IAM · Super-admin creation  (SUPER_ADMIN only — highest privilege)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  POST — create another SUPER_ADMIN with an initial password.
 *
 *  Deliberately a SEPARATE surface from /api/platform/iam/users, which must
 *  never be able to mint SUPER_ADMIN accounts. Guarded by an explicit
 *  SUPER_ADMIN role check (not a delegable capability).
 *
 *  Security notes:
 *   - The new account has totpEnabledAt = null, so the normal authorize flow
 *     forces Google Authenticator enrolment on first sign-in. Not bypassed.
 *   - The password is hashed with argon2 and is NEVER returned or audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import argon2 from 'argon2';
import { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireSuperAdminApi } from '@/server/api-auth';
import { clientIp } from '@/server/http/rate-limit';

export const dynamic = 'force-dynamic';

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  password: z.string().min(12).max(200),
});

export async function POST(req: NextRequest) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    // Never echo the submitted body (it contains the password); issues only.
    const detail = e instanceof z.ZodError
      ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : 'Malformed request body.';
    return Response.json({ error: 'invalid_body', detail }, { status: 400 });
  }

  const email = body.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return Response.json(
      { error: 'email_taken', message: 'A user with that email already exists.' },
      { status: 409 },
    );
  }

  const passwordHash = await argon2.hash(body.password);
  let created: { id: string; email: string | null; role: Role };
  try {
    created = await prisma.user.create({
      data: { name: body.name.trim(), email, passwordHash, mustChangePassword: true, role: Role.SUPER_ADMIN },
      select: { id: true, email: true, role: true },
    });
  } catch (e: any) {
    // Race on the unique email constraint (TOCTOU vs the pre-check above).
    if (e?.code === 'P2002') {
      return Response.json(
        { error: 'email_taken', message: 'A user with that email already exists.' },
        { status: 409 },
      );
    }
    throw e;
  }

  await audit('iam.superadmin.create', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'User',
    entityId: created.id,
    after: { email: created.email, role: created.role },
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  }).catch(() => {});

  return Response.json(
    { ok: true, user: { id: created.id, email: created.email, role: created.role } },
    { status: 201 },
  );
}
