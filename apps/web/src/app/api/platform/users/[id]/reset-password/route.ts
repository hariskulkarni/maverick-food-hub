/**
 * POST /api/platform/users/[id]/reset-password — SUPER_ADMIN only.
 * Sets a new password for any user without email. Revokes every session; for
 * staff roles also clears TOTP so they re-enrol Google Authenticator.
 * The password is never logged, audited or returned.
 */
import { NextRequest } from 'next/server';
import argon2 from 'argon2';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { isStaffTotpRole } from '@/server/user-totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ password: z.string().min(12).max(200) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user?.role !== 'SUPER_ADMIN') {
    return Response.json({ error: 'Only a super-admin can reset passwords.' }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Password must be at least 12 characters.' }, { status: 400 });
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, deletedAt: true } });
  if (!target || target.deletedAt) return Response.json({ error: 'User not found.' }, { status: 404 });

  const staff = isStaffTotpRole(target.role);
  const passwordHash = await argon2.hash(parsed.data.password);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        passwordHash,
        currentSessionId: null,
        ...(staff ? { totpSecret: null, totpPendingSecret: null, totpEnabledAt: null } : {}),
      },
    });
    await tx.userSession.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'admin_password_reset' },
    });
  });

  await audit('platform.user.password.reset', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'User',
    entityId: id,
    after: { sessionsRevoked: true, totpCleared: staff },
  }).catch(() => {});
  return Response.json({ ok: true, staffReenroll: staff });
}
