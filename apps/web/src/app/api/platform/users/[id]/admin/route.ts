/**
 * POST /api/platform/users/[id]/admin — SUPER_ADMIN account-recovery actions
 * for ANY user (see src/server/platform-user-admin.ts).
 *
 *   { action: 'reset_password', password?: string }  → { ok, generated, tempPassword? }
 *   { action: 'reset_totp' } | { action: 'unlock' } | { action: 'sign_out' }
 *   { action: 'set_role', role }
 *   { action: 'suspend', reason? } | { action: 'unsuspend' }
 *
 * The generated temp password is returned once (Cache-Control: no-store) and
 * never logged or audited. Super-admin sessions already require TOTP at login.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Role } from '@prisma/client';
import { requireSuperAdminApi } from '@/server/api-auth';
import { clientIp } from '@/server/http/rate-limit';
import {
  adminResetPassword, adminResetTotp, adminUnlock, adminSetRole, adminSetSuspended, adminSignOut,
  type AdminResult,
} from '@/server/platform-user-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('reset_password'), password: z.string().max(200).optional() }),
  z.object({ action: z.literal('reset_totp') }),
  z.object({ action: z.literal('unlock') }),
  z.object({ action: z.literal('sign_out') }),
  z.object({ action: z.literal('set_role'), role: z.nativeEnum(Role) }),
  z.object({ action: z.literal('suspend'), reason: z.string().max(300).optional() }),
  z.object({ action: z.literal('unsuspend') }),
]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdminApi();
  if (session instanceof Response) return session;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });

  const actor = { id: session.user.id, role: session.user.role };
  const meta = { ip: clientIp(req), userAgent: req.headers.get('user-agent') };
  const b = parsed.data;
  let r: AdminResult<Record<string, unknown>>;
  switch (b.action) {
    case 'reset_password': r = await adminResetPassword(actor, id, { password: b.password || undefined }, meta); break;
    case 'reset_totp':     r = await adminResetTotp(actor, id, meta); break;
    case 'unlock':         r = await adminUnlock(actor, id, meta); break;
    case 'sign_out':       r = await adminSignOut(actor, id, meta); break;
    case 'set_role':       r = await adminSetRole(actor, id, b.role, meta); break;
    case 'suspend':        r = await adminSetSuspended(actor, id, true, b.reason, meta); break;
    case 'unsuspend':      r = await adminSetSuspended(actor, id, false, undefined, meta); break;
  }
  if (!r.ok) return Response.json({ error: r.message, code: r.error }, { status: r.status });
  return Response.json(r, { headers: { 'Cache-Control': 'no-store' } });
}
