/**
 * Platform security settings — GET (status) + PATCH (allowlist / lockout).
 *
 * NEVER returns the TOTP secret. The secret is only ever surfaced once,
 * during the /totp/setup flow, and never again.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { getPlatformSecurity, setPlatformSecurity } from '@/server/2fa';
import { audit } from '@/server/audit';

export async function GET() {
  await requireSuperAdmin();
  const sec = await getPlatformSecurity();
  return Response.json({
    totpEnabled: Boolean(sec.totpSecret),
    totpPending: Boolean(sec.totpPending),
    allowlist: sec.allowlist ?? [],
    lockoutMinutes: sec.lockoutMinutes ?? 15
  });
}

const PatchBody = z.object({
  allowlist: z.array(z.string()).optional(),
  lockoutMinutes: z.number().int().min(1).max(1440).optional()
});

export async function PATCH(req: NextRequest) {
  const session = await requireSuperAdmin();
  const body = PatchBody.parse(await req.json());
  const before = await getPlatformSecurity();
  await setPlatformSecurity({
    allowlist: body.allowlist?.map((s) => s.trim()).filter(Boolean),
    lockoutMinutes: body.lockoutMinutes
  });
  await audit('platform.security.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSecurity',
    before: { allowlistCount: before.allowlist?.length ?? 0, lockoutMinutes: before.lockoutMinutes ?? null },
    after: { allowlistCount: body.allowlist?.length ?? 0, lockoutMinutes: body.lockoutMinutes ?? null }
  });
  return Response.json({ ok: true });
}
