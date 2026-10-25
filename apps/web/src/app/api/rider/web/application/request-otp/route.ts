/**
 * POST /api/rider/web/application/request-otp — rider portal, applicant path.
 *
 * Someone who applied at /signup/rider but has no rider account yet can check
 * their application status. We text a code (purpose phone_verify — separate
 * counters from login) only when an application exists for the phone AND the
 * phone isn't already a rider account (riders sign in normally instead).
 *
 * Body: { phone }   200: { ok: true, devCode? }   404: { error: 'no_application' }
 * Same-origin only (riderCookieRequestAllowed).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { sendOtp, OtpRateLimitedError } from '@/server/otp';
import { rateLimit } from '@/server/http/rate-limit';
import { clientIp } from '@/server/http/client-ip';
import { riderCookieRequestAllowed } from '@/server/rider-auth';
import { parseOrJsonError } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ phone: z.string().trim().min(8).max(20) });

export async function POST(req: NextRequest) {
  if (!riderCookieRequestAllowed(req.headers)) {
    return Response.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }
  const rl = await rateLimit(req, { name: 'rider-application-otp', limit: 5, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const parsed = parseOrJsonError(Body, await req.json().catch(() => null));
  if (parsed instanceof Response) return parsed;
  const { phone } = parsed;

  const [application, user] = await Promise.all([
    prisma.riderApplication.findUnique({ where: { phone }, select: { id: true } }),
    prisma.user.findUnique({ where: { phone }, select: { role: true } }),
  ]);
  if (!application || user?.role === 'RIDER') {
    return Response.json({ error: 'no_application' }, { status: 404 });
  }
  try {
    const r = await sendOtp({ phone, purpose: 'phone_verify', ipAddress: clientIp(req.headers) ?? undefined });
    return Response.json(r);
  } catch (e) {
    if (e instanceof OtpRateLimitedError) {
      return Response.json(
        { error: e.message, retryAfter: e.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(e.retryAfterSeconds) } },
      );
    }
    return Response.json({ error: 'Could not send the code. Please try again.' }, { status: 502 });
  }
}
