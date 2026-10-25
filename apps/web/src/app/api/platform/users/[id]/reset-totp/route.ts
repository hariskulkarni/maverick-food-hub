/**
 * POST /api/platform/users/[id]/reset-totp — SUPER_ADMIN only.
 * Clears a staff / platform-team member's Google Authenticator so they re-enrol
 * on next login (the lost-device recovery path; we chose no backup codes).
 * Thin wrapper over adminResetTotp (src/server/platform-user-admin.ts).
 */
import { NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/server/api-auth';
import { clientIp } from '@/server/http/rate-limit';
import { adminResetTotp } from '@/server/platform-user-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdminApi();
  if (session instanceof Response) return session;
  const { id } = await params;
  const r = await adminResetTotp(
    { id: session.user.id, role: session.user.role },
    id,
    { ip: clientIp(req), userAgent: req.headers.get('user-agent') },
  );
  if (!r.ok) return Response.json({ error: r.message, code: r.error }, { status: r.status });
  return Response.json({ ok: true });
}
