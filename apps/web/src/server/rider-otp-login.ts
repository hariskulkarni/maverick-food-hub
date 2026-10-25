/**
 * Rider OTP sign-in (step 2), shared by the native app's
 * POST /api/rider/auth/verify-otp (client 'rider-app') and the web portal's
 * POST /api/rider/web/session (client 'rider-web'). Confirms the account is a
 * RIDER, verifies the OTP, starts a rider session for that surface and issues
 * a 7-day session-bound token.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { verifyOtp } from '@/server/otp';
import { signRiderToken } from '@/server/rider-auth';
import { rateLimit } from '@/server/http/rate-limit';
import { audit } from '@/server/audit';
import { startRiderSession, type RiderClient } from '@/server/sessions';
import { clientIp } from '@/server/http/client-ip';


const Body = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().min(4).max(8)
});

/**
 * Shared by the native app (client 'rider-app') and the web portal's
 * /api/rider/web/session (client 'rider-web'). The client decides which older
 * session the new login supersedes — never the other surface's.
 */
export async function verifyRiderOtp(req: NextRequest, client: RiderClient) {
  const rl = await rateLimit(req, { name: 'rider-otp-verify', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const { phone, code } = Body.parse(await req.json());

    // Role check first — so a non-rider hitting this directly never even
    // consumes an OTP token.
    const user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, name: true, phone: true, role: true, suspendedAt: true, deletedAt: true }
    });
    if (!user || user.role !== 'RIDER' || user.deletedAt) {
      return Response.json({ error: 'not_a_rider' }, { status: 403 });
    }
    // Suspended accounts cannot log in (a super-admin has blocked them). Mirror
    // the web NextAuth flow so suspension reaches the native rider app too.
    if (user.suspendedAt) {
      await audit('auth.login.failed', {
        actorId: user.id,
        entityType: 'User',
        entityId: user.id,
        after: { reason: 'suspended', provider: 'rider-otp' }
      }).catch(() => {});
      return Response.json({ error: 'suspended' }, { status: 403 });
    }

    const ok = await verifyOtp({ phone, code, purpose: 'login' });
    if (!ok) {
      return Response.json({ error: 'invalid_code' }, { status: 401 });
    }

    const sid = await startRiderSession(user.id, client, {
      userAgent: req.headers.get('user-agent'),
      ipAddress: clientIp(req.headers)
    });
    if (!sid) return Response.json({ error: 'Could not start a session. Please try again.' }, { status: 503 });
    const { token, expiresAt } = signRiderToken(user.id, sid);
    return Response.json({
      token,
      expiresAt: expiresAt.toISOString(),
      rider: { id: user.id, name: user.name ?? null, phone: user.phone ?? null }
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
