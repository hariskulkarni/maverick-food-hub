/**
 * POST /api/rider/auth/request-otp
 *
 * Native rider app — step 1 of login. Sends a phone OTP, but ONLY if the phone
 * belongs to a registered rider. This is what keeps the native app rider-only:
 * a customer's or staff member's phone simply can't get a code here.
 *
 * Body: { phone: string }
 * 200:  { ok: true, devCode?: string }   devCode present only when OTP_DEBUG_LOG=true
 * 404:  { error: 'not_a_rider' }          phone is not a rider account
 * 429:  { error, retryAfter }             rate limited (see src/server/otp.ts)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { sendOtp, OtpRateLimitedError } from '@/server/otp';
import { rateLimit } from '@/server/http/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ phone: z.string().min(8).max(20) });

function clientIp(req: NextRequest): string | undefined {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim();
  return req.headers.get('x-real-ip') ?? undefined;
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'rider-otp-send', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const { phone } = Body.parse(await req.json());

    // Rider-only gate: the phone must already belong to a RIDER account.
    const user = await prisma.user.findUnique({
      where: { phone },
      select: { role: true }
    });
    if (!user || user.role !== 'RIDER') {
      // Vague on purpose — don't leak which phone numbers are registered riders.
      return Response.json({ error: 'not_a_rider' }, { status: 404 });
    }

    const r = await sendOtp({ phone, purpose: 'login', ipAddress: clientIp(req) });
    return Response.json(r);
  } catch (e) {
    if (e instanceof OtpRateLimitedError) {
      return Response.json(
        { error: e.message, retryAfter: e.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(e.retryAfterSeconds) } }
      );
    }
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
