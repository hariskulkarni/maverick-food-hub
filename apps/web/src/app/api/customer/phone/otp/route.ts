/**
 * POST /api/customer/phone/otp  { phone }
 *
 * Sends a phone-verification OTP to the signed-in CUSTOMER (the mandatory
 * "Add your phone" step after Google sign-in, and changing the number from the
 * profile). Uses the shared OTP engine with purpose `phone_verify`, so every
 * limit still applies: 45s resend cooldown, per-phone hourly/daily caps, per-IP
 * cap, platform SMS budget and the failed-verify lockout. Pre-launch test
 * accounts get their code on screen exactly like the login. Nothing about other
 * accounts is revealed here — ownership is only checked after the OTP proves it.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { sendOtp, OtpRateLimitedError, OtpDeliveryError } from '@/server/otp';
import { rateLimit } from '@/server/http/rate-limit';
import { clientIp } from '@/server/http/client-ip';
import { PHONE_VERIFY_PURPOSE, isIndianMobileE164 } from '@/server/customer-phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ phone: z.string().trim().max(20) });

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'customer-phone-otp', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
  if (session.user.role !== 'CUSTOMER') {
    return Response.json({ error: 'Only customer accounts can add a phone here.' }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isIndianMobileE164(parsed.data.phone)) {
    return Response.json({ error: 'Enter a valid 10-digit Indian mobile number (starts with 6, 7, 8 or 9).' }, { status: 400 });
  }
  const phone = parsed.data.phone;
  if (session.user.phoneVerified && session.user.phone === phone) {
    return Response.json({ error: "That's already your verified number." }, { status: 400 });
  }
  try {
    const r = await sendOtp({ phone, purpose: PHONE_VERIFY_PURPOSE, ipAddress: clientIp(req.headers) ?? undefined });
    return Response.json(r);
  } catch (e) {
    if (e instanceof OtpRateLimitedError) {
      return Response.json(
        { error: e.message, retryAfter: e.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(e.retryAfterSeconds) } },
      );
    }
    if (e instanceof OtpDeliveryError) return Response.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
