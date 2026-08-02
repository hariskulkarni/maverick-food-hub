/**
 * POST /api/auth/staff/precheck  { email, password }
 *
 * Step 1 of the staff (ADMIN/SUPER_ADMIN/KITCHEN) login. Validates the password
 * (never leaking which factor failed), then tells the client whether this
 * account still needs to enrol a Google Authenticator or already has one:
 *   { ok:false }                              → bad credentials / not staff
 *   { ok:true, status:'enroll', qr, secret }  → first-time: scan QR then confirm
 *   { ok:true, status:'totp' }                → enrolled: enter the 6-digit code
 *
 * Returning the QR/secret only AFTER a correct password means an anonymous
 * caller can never trigger or read an enrollment.
 */
import { NextRequest } from 'next/server';
import argon2 from 'argon2';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';
import { isStaffTotpRole, isTotpEnrolled, startEnrollment } from '@/server/user-totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'staff-precheck', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  let body: { email?: string; password?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = String(body.email ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  if (!email || !password) return Response.json({ ok: false });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !isStaffTotpRole(user.role) || user.suspendedAt) {
    return Response.json({ ok: false });
  }
  const okPw = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!okPw) return Response.json({ ok: false });

  if (!isTotpEnrolled(user)) {
    const { qr, secret, otpauth } = await startEnrollment(user.id, user.email ?? email);
    return Response.json({ ok: true, status: 'enroll', qr, secret, otpauth });
  }
  return Response.json({ ok: true, status: 'totp' });
}
