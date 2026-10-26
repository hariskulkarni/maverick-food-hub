/**
 * Pre-launch test accounts (CUSTOMER / RIDER) — super-admin console API.
 *
 *   GET    → list test accounts (active and deleted)
 *   POST   { phone, role, name? } → create (same guards as scripts/test-account.ts)
 *   DELETE { phone }              → delete (clear flag, soft-delete, revoke sessions)
 *
 * SUPER_ADMIN with a 2FA (TOTP) session only — the observability-grade gate.
 * Every create/delete is audited. Logic lives in server/test-accounts.ts.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { superAdmin2faSession } from '@/server/observability/access';
import { unauthenticated, forbidden } from '@/server/api-auth';
import { createTestAccount, deleteTestAccount, listTestAccounts } from '@/server/test-accounts';
import { parseJsonBody } from '@/server/http/validate';
import { rateLimit, clientIp } from '@/server/http/rate-limit';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

async function gate() {
  const r = await superAdmin2faSession();
  if ('ok' in r) return r.ok;
  if (r.deny === 'unauthenticated') return unauthenticated();
  if (r.deny === '2fa') {
    return forbidden('Test accounts require a super-admin session signed in with Google Authenticator (2FA).');
  }
  return forbidden('Test accounts are restricted to platform super-admins.');
}

const CreateBody = z.object({
  phone: z.string().trim().min(8).max(20),
  role: z.enum(['CUSTOMER', 'RIDER']),
  name: z.string().trim().max(80).optional(),
});
const DeleteBody = z.object({ phone: z.string().trim().min(8).max(20) });

export async function GET() {
  const g = await gate();
  if (g instanceof Response) return g;
  const rows = await listTestAccounts();
  return Response.json({
    accounts: rows.map((u) => ({
      id: u.id,
      phone: u.phone,
      name: u.name,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      deletedAt: u.deletedAt?.toISOString() ?? null,
      suspendedAt: u.suspendedAt?.toISOString() ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'platform-test-accounts', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const g = await gate();
  if (g instanceof Response) return g;
  const parsed = await parseJsonBody(req, CreateBody);
  if (!parsed.ok) return parsed.response;
  const { phone, role, name } = parsed.data;
  const r = await createTestAccount(phone, name, role, { allowExistingCustomer: false });
  if (!r.ok) return Response.json({ error: r.message }, { status: 409 });
  await audit('user.test_account.create', {
    actorId: g.userId,
    actorRole: 'SUPER_ADMIN',
    entityType: 'User',
    entityId: r.userId,
    after: { phone: r.phone, role, testAccount: true },
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });
  return Response.json({ ok: true, phone: r.phone, message: r.message });
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'platform-test-accounts', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const g = await gate();
  if (g instanceof Response) return g;
  const parsed = await parseJsonBody(req, DeleteBody);
  if (!parsed.ok) return parsed.response;
  const r = await deleteTestAccount(parsed.data.phone);
  if (!r.ok) return Response.json({ error: r.message }, { status: 404 });
  await audit('user.test_account.delete', {
    actorId: g.userId,
    actorRole: 'SUPER_ADMIN',
    entityType: 'User',
    entityId: r.userId,
    before: { phone: r.phone, testAccount: true },
    after: { deleted: true },
    ipAddress: clientIp(req),
    userAgent: req.headers.get('user-agent'),
  });
  return Response.json({ ok: true, phone: r.phone, message: r.message });
}
