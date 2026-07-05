/**
 * IAM · single platform-team user  (SUPER_ADMIN only — `iam:manage`)
 *
 *   PATCH — change role (within the assignable set) and/or suspend / reinstate.
 *
 * Guardrails: the target MUST currently hold an assignable platform role. This
 * endpoint refuses to touch SUPER_ADMIN accounts, restaurant staff, customers,
 * or riders — preventing accidental privilege escalation or lock-out of the
 * platform owner. Suspension force-logs-out the user everywhere immediately.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { requireCapabilityApi } from '@/server/api-auth';
import { clientIp } from '@/server/http/rate-limit';
import { ASSIGNABLE_PLATFORM_ROLES, capabilitiesFor } from '@/server/permissions';
import type { Role } from '@prisma/client';

export const dynamic = 'force-dynamic';

const ASSIGNABLE = ASSIGNABLE_PLATFORM_ROLES as unknown as [string, ...string[]];
const isAssignable = (r: string) => (ASSIGNABLE_PLATFORM_ROLES as unknown as string[]).includes(r);

const PatchBody = z
  .object({
    role: z.enum(ASSIGNABLE).optional(),
    suspended: z.boolean().optional(),
    suspendReason: z.string().max(300).optional(),
  })
  .refine((b) => b.role !== undefined || b.suspended !== undefined, {
    message: 'Nothing to update',
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapabilityApi('iam:manage');
  if (gate instanceof Response) return gate;
  const session = await auth();
  const { id } = await params;

  let data: z.infer<typeof PatchBody>;
  try {
    data = PatchBody.parse(await req.json());
  } catch (e) {
    return Response.json({ error: 'invalid_body', detail: (e as Error).message }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, suspendedAt: true, email: true },
  });
  if (!target || (target as { deletedAt?: Date | null }).deletedAt) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  // Refuse to manage anyone who isn't already a platform-team member — this
  // endpoint cannot mint/undo super-admins or edit restaurant/customer accounts.
  if (!isAssignable(target.role)) {
    return Response.json(
      { error: 'protected_account', message: 'This user is not a platform-team account and cannot be managed here.' },
      { status: 403 },
    );
  }
  // A super-admin cannot suspend/change themselves through IAM (belt-and-braces:
  // they aren't assignable anyway, but guard explicitly).
  if (id === session?.user?.id) {
    return Response.json({ error: 'self_forbidden', message: 'You cannot modify your own account here.' }, { status: 403 });
  }

  const before = { role: target.role, suspended: Boolean(target.suspendedAt) };

  await prisma.$transaction(async (tx) => {
    if (data.role && data.role !== target.role) {
      await tx.user.update({ where: { id }, data: { role: data.role as Role } });
    }
    if (data.suspended !== undefined) {
      await tx.user.update({
        where: { id },
        data: {
          suspendedAt: data.suspended ? new Date() : null,
          suspendedReason: data.suspended ? (data.suspendReason ?? 'Suspended by platform admin') : null,
          ...(data.suspended ? { currentSessionId: null } : {}),
        },
      });
      if (data.suspended) {
        // Force logout everywhere: revoke every live session token.
        await tx.userSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date(), revokedReason: 'iam_suspended' },
        });
      }
    }
  });

  const ip = clientIp(req);
  const ua = req.headers.get('user-agent');
  if (data.role && data.role !== before.role) {
    await audit('iam.role.assign', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      entityType: 'User',
      entityId: id,
      before: { role: before.role },
      after: { role: data.role },
      ipAddress: ip,
      userAgent: ua,
    }).catch(() => {});
  }
  if (data.suspended !== undefined && data.suspended !== before.suspended) {
    await audit(data.suspended ? 'iam.user.suspend' : 'iam.user.reinstate', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      entityType: 'User',
      entityId: id,
      before: { suspended: before.suspended },
      after: { suspended: data.suspended, reason: data.suspended ? (data.suspendReason ?? null) : null },
      ipAddress: ip,
      userAgent: ua,
    }).catch(() => {});
  }

  const updated = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, suspendedAt: true, suspendedReason: true },
  });
  return Response.json({ ok: true, user: { ...updated, capabilities: capabilitiesFor(updated!.role) } });
}
