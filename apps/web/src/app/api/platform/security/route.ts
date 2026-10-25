/**
 * Platform security settings — GET (status) + PATCH (allowlist / lockout).
 *
 * NEVER returns the TOTP secret. The secret is only ever surfaced once,
 * during the /totp/setup flow, and never again.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { getPlatformSecurity, setPlatformSecurity } from '@/server/2fa';
import { getOtpMode, setOtpMode, realOtpDeliveryConfigured } from '@/server/otp';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';

export async function GET() {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const sec = await getPlatformSecurity();
  return Response.json({
    totpEnabled: Boolean(sec.totpSecret),
    totpPending: Boolean(sec.totpPending),
    allowlist: sec.allowlist ?? [],
    lockoutMinutes: sec.lockoutMinutes ?? 15,
    otpMode: await getOtpMode()
  });
}

const PatchBody = z.object({
  allowlist: z.array(z.string()).optional(),
  lockoutMinutes: z.number().int().min(1).max(1440).optional(),
  otpMode: z.enum(['demo', 'production']).optional()
});

export async function PATCH(req: NextRequest) {
  const session = await requireSuperAdminApi();
  if (session instanceof Response) return session;
  const parsed = parseOrJsonError(PatchBody, await req.json());
  if (parsed instanceof Response) return parsed;
  const body = parsed;
  // C9: refuse to switch OTP into demo mode while a real SMS/WhatsApp provider
  // is configured — demo surfaces live OTP codes to any caller for any number.
  if (body.otpMode === 'demo' && realOtpDeliveryConfigured()) {
    return Response.json(
      { error: 'Cannot enable OTP demo mode while a real SMS/WhatsApp provider is configured — it would surface live OTP codes.' },
      { status: 400 }
    );
  }
  const before = await getPlatformSecurity();
  await setPlatformSecurity({
    allowlist: body.allowlist?.map((s) => s.trim()).filter(Boolean),
    lockoutMinutes: body.lockoutMinutes
  });
  if (body.otpMode) await setOtpMode(body.otpMode);
  await audit('platform.security.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSecurity',
    before: { allowlistCount: before.allowlist?.length ?? 0, lockoutMinutes: before.lockoutMinutes ?? null },
    after: { allowlistCount: body.allowlist?.length ?? 0, lockoutMinutes: body.lockoutMinutes ?? null }
  });
  return Response.json({ ok: true });
}
