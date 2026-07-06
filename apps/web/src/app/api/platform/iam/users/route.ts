/**
 * ─────────────────────────────────────────────────────────────────────────
 *  IAM · Platform-team user management  (SUPER_ADMIN only — `iam:manage`)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  GET   — list the platform-team users (the roles a SUPER_ADMIN can assign,
 *          plus fellow super-admins for visibility) with their capabilities.
 *  POST  — create a new platform-team user with an email/password login and
 *          one of the assignable roles (Admin Assist / Developer / QA / Guest).
 *
 *  This surface intentionally manages ONLY platform-team roles. It cannot
 *  create, edit, or delete SUPER_ADMIN accounts, restaurant staff (ADMIN /
 *  KITCHEN), customers, or riders — those are protected from this endpoint to
 *  avoid privilege-escalation footguns. Every mutation is audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import argon2 from 'argon2';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { requireCapabilityApi } from '@/server/api-auth';
import { clientIp } from '@/server/http/rate-limit';
import {
  ASSIGNABLE_PLATFORM_ROLES,
  capabilitiesFor,
} from '@/server/permissions';
import type { Role } from '@prisma/client';

export const dynamic = 'force-dynamic';

const ASSIGNABLE = ASSIGNABLE_PLATFORM_ROLES as unknown as [string, ...string[]];

/** Roles visible in the IAM console: the assignable set + super-admins. */
const VISIBLE_ROLES = ['SUPER_ADMIN', ...ASSIGNABLE_PLATFORM_ROLES] as unknown as Role[];

export async function GET() {
  const gate = await requireCapabilityApi('iam:manage');
  if (gate instanceof Response) return gate;

  const users = await prisma.user.findMany({
    where: { role: { in: VISIBLE_ROLES }, deletedAt: null },
    orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      suspendedAt: true,
      suspendedReason: true,
      createdAt: true,
    },
  });

  return Response.json({
    users: users.map((u) => ({
      ...u,
      capabilities: capabilitiesFor(u.role),
      editable: (ASSIGNABLE_PLATFORM_ROLES as unknown as string[]).includes(u.role),
    })),
    assignableRoles: (ASSIGNABLE_PLATFORM_ROLES as unknown as string[]).map((r) => ({
      role: r,
      capabilities: capabilitiesFor(r as Role),
    })),
  });
}

const CreateBody = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().email().max(160),
  // Reasonable staff-password floor. Full policy (rotation, complexity) can be
  // layered on later; kept simple + strong here.
  password: z.string().min(12).max(200),
  role: z.enum(ASSIGNABLE),
});

export async function POST(req: NextRequest) {
  const gate = await requireCapabilityApi('iam:manage');
  if (gate instanceof Response) return gate;
  const session = await auth();

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    return Response.json({ error: 'invalid_body', detail: (e as Error).message }, { status: 400 });
  }

  const email = body.email.toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return Response.json({ error: 'email_taken', message: 'A user with that email already exists.' }, { status: 409 });
  }

  const passwordHash = await argon2.hash(body.password);
  const created = await prisma.user.create({
    data: {
      name: body.name.trim(),
      email,
      passwordHash,
      role: body.role as Role,
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  await audit('iam.user.create', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'User',
    entityId: created.id,
    after: { email: created.email, role: created.role },
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  }).catch(() => {});

  return Response.json(
    { ok: true, user: { ...created, capabilities: capabilitiesFor(created.role) } },
    { status: 201 },
  );
}
