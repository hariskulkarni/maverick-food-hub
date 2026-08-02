/**
 * POST /api/platform/users/[id]/reset-totp  — SUPER_ADMIN only.
 * Clears a staff member's Google Authenticator so they must re-enrol on next
 * login. The recovery path (we chose no backup codes).
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { resetUserTotp, isStaffTotpRole } from '@/server/user-totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user?.role !== 'SUPER_ADMIN') {
    return Response.json({ error: 'Only a super-admin can reset 2FA.' }, { status: 403 });
  }
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, email: true } });
  if (!target || !isStaffTotpRole(target.role)) {
    return Response.json({ error: 'User not found or not a staff account.' }, { status: 404 });
  }
  await resetUserTotp(id);
  await audit('auth.totp.reset', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'User',
    entityId: id,
    after: { email: target.email },
  }).catch(() => {});
  return Response.json({ ok: true });
}
