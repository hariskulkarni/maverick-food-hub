/**
 * Activate the pending TOTP secret by submitting a current code from the
 * authenticator app. On success, `totpPending` is promoted to `totpSecret`
 * and 2FA becomes enforced at next login.
 *
 * POST { token: '123456' }   — verifies + activates
 * DELETE                      — disables 2FA entirely (must already be enrolled)
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { getPlatformSecurity, setPlatformSecurity, verifyTotp } from '@/server/2fa';
import { audit } from '@/server/audit';

const Body = z.object({ token: z.string().min(6).max(8) });

export async function POST(req: NextRequest) {
  const session = await requireSuperAdmin();
  const { token } = Body.parse(await req.json());
  const sec = await getPlatformSecurity();
  if (!sec.totpPending) {
    return Response.json({ ok: false, error: 'No pending TOTP setup. Call /setup first.' }, { status: 400 });
  }
  if (!verifyTotp(sec.totpPending, token)) {
    return Response.json({ ok: false, error: 'Invalid code.' }, { status: 400 });
  }
  // Promote pending -> active. Clear pending.
  await setPlatformSecurity({
    ...sec,
    totpSecret: sec.totpPending,
    totpPending: undefined
  });
  await audit('platform.security.totp.activate', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSecurity'
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const session = await requireSuperAdmin();
  const sec = await getPlatformSecurity();
  await setPlatformSecurity({ ...sec, totpSecret: undefined, totpPending: undefined });
  await audit('platform.security.totp.disable', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSecurity'
  });
  return Response.json({ ok: true });
}
