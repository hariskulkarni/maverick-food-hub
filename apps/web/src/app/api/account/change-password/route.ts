/**
 * POST /api/account/change-password — signed-in user changes their own
 * password. Verifies the current password, sets the new hash and revokes all
 * OTHER sessions while keeping the caller's current one alive.
 * Passwords are never logged, audited or returned.
 */
import { NextRequest } from 'next/server';
import argon2 from 'argon2';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_input', message: 'New password must be at least 12 characters.' }, { status: 400 });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true, currentSessionId: true, deletedAt: true },
  });
  const ok = !!user && !user.deletedAt && !!user.passwordHash && (await argon2.verify(user.passwordHash, currentPassword).catch(() => false));
  if (!user || !ok) return Response.json({ error: 'invalid_current' }, { status: 400 });

  const passwordHash = await argon2.hash(newPassword);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.userSession.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        ...(user.currentSessionId ? { id: { not: user.currentSessionId } } : {}),
      },
      data: { revokedAt: now, revokedReason: 'password_changed' },
    });
  });

  await audit('account.password.change', {
    actorId: user.id,
    actorRole: session.user.role,
    entityType: 'User',
    entityId: user.id,
    after: { otherSessionsRevoked: true },
  }).catch(() => {});
  return Response.json({ ok: true });
}
