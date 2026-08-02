/**
 * POST /api/auth/staff/enroll  { email, password, code }
 *
 * Step 2 (first-time only). Re-validates the password, then confirms the first
 * Google Authenticator code against the pending secret and activates 2FA. After
 * { ok:true } the client completes a normal signIn with the same code.
 */
import { NextRequest } from 'next/server';
import argon2 from 'argon2';
import { prisma } from '@/server/db';
import { rateLimit } from '@/server/http/rate-limit';
import { isStaffTotpRole, confirmEnrollment } from '@/server/user-totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'staff-enroll', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  let body: { email?: string; password?: string; code?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const email = String(body.email ?? '').toLowerCase().trim();
  const password = String(body.password ?? '');
  const code = String(body.code ?? '').trim();
  if (!email || !password || !code) return Response.json({ ok: false });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !isStaffTotpRole(user.role) || user.suspendedAt) {
    return Response.json({ ok: false });
  }
  const okPw = await argon2.verify(user.passwordHash, password).catch(() => false);
  if (!okPw) return Response.json({ ok: false });

  const ok = await confirmEnrollment(user.id, code);
  return Response.json({ ok });
}
