/**
 * POST /api/auth/staff/change-password  { email, password, newPassword }
 *
 * Login step for an account whose password was reset by a SUPER_ADMIN
 * (User.mustChangePassword): proves the temporary password, sets the user's own
 * password and clears the flag. Only works while a change is pending, so it is
 * never a way to change a password without the authenticator. Shares the login
 * lockout. Afterwards the client re-runs /api/auth/staff/precheck with the new
 * password (→ TOTP enrolment or code).
 *   { ok:true } | { ok:false } | { ok:false, locked:true, retryAfterSeconds } | 400 { error }
 */
import { NextRequest } from 'next/server';
import argon2 from 'argon2';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';
import { getPlatformSecurity, isLockedOut, lockoutRemainingMs, recordLoginFailure, recordLoginSuccess } from '@/server/2fa';
import { audit } from '@/server/audit';
import { ADMIN_MIN_PASSWORD_LENGTH } from '@/server/platform-user-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'staff-change-password', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  let body: { email?: string; password?: string; newPassword?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = String(body.email ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  const newPassword = String(body.newPassword ?? '');
  if (!email || !password) return Response.json({ ok: false });
  if (newPassword.length < ADMIN_MIN_PASSWORD_LENGTH || newPassword.length > 200) {
    return Response.json({ error: `Use at least ${ADMIN_MIN_PASSWORD_LENGTH} characters.` }, { status: 400 });
  }
  if (newPassword === password) {
    return Response.json({ error: 'Choose a password different from the temporary one.' }, { status: 400 });
  }

  if (isLockedOut(email)) {
    return Response.json({ ok: false, locked: true, retryAfterSeconds: Math.ceil(lockoutRemainingMs(email) / 1000) });
  }
  const sec = await getPlatformSecurity().catch(() => ({ lockoutMinutes: undefined }));
  const lockoutMinutes = sec.lockoutMinutes ?? 15;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || user.suspendedAt || user.deletedAt || !user.mustChangePassword) {
    recordLoginFailure(email, lockoutMinutes);
    return Response.json({ ok: false });
  }
  const okPw = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!okPw) {
    recordLoginFailure(email, lockoutMinutes);
    return Response.json({ ok: false });
  }

  const passwordHash = await argon2.hash(newPassword);
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, mustChangePassword: true },
    data: { passwordHash, mustChangePassword: false },
  });
  if (claimed.count !== 1) return Response.json({ ok: false });
  recordLoginSuccess(email);
  await audit('auth.password.changed_after_reset', {
    actorId: user.id, actorRole: user.role, entityType: 'User', entityId: user.id,
  }).catch(() => {});
  return Response.json({ ok: true });
}
