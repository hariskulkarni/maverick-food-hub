/**
 * POST /api/platform/users/[id]/reset-password { password } — SUPER_ADMIN only.
 * Sets a chosen password for any user (no email). Thin wrapper over
 * adminResetPassword (src/server/platform-user-admin.ts): revokes every session
 * and forces a password change at next login. TOTP is a separate action
 * (reset-totp / admin { action: 'reset_totp' }). The password is never logged,
 * audited or returned.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { clientIp } from '@/server/http/rate-limit';
import { adminResetPassword, ADMIN_MIN_PASSWORD_LENGTH } from '@/server/platform-user-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ password: z.string().min(ADMIN_MIN_PASSWORD_LENGTH).max(200) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdminApi();
  if (session instanceof Response) return session;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: `Password must be at least ${ADMIN_MIN_PASSWORD_LENGTH} characters.` }, { status: 400 });
  }
  const r = await adminResetPassword(
    { id: session.user.id, role: session.user.role },
    id,
    { password: parsed.data.password },
    { ip: clientIp(req), userAgent: req.headers.get('user-agent') },
  );
  if (!r.ok) return Response.json({ error: r.message, code: r.error }, { status: r.status });
  return Response.json({ ok: true, staffReenroll: false });
}
