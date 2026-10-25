/**
 * Test-account probe for the MSG91-widget login path.
 *
 * When the MSG91 widget is enabled the browser sends OTPs through MSG91 and
 * never calls /api/auth/otp, so a pre-launch test account would get no code.
 * The login page asks here first: for an active test account this issues a
 * built-in OTP (same limits as /api/auth/otp) and returns it for the screen;
 * for every other number it returns `{ testAccount: false }` and issues nothing,
 * without revealing whether that number has an account.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sendOtp, OtpRateLimitedError } from '@/server/otp';
import { findActiveTestAccount } from '@/server/test-accounts';
import { parseJsonBody } from '@/server/http/validate';
import { rateLimit } from '@/server/http/rate-limit';
import { clientIp } from '@/server/http/client-ip';

const Body = z.object({ phone: z.string().min(8).max(20) });

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'otp-test-account', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const parsed = await parseJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  if (!(await findActiveTestAccount(parsed.data.phone))) return Response.json({ testAccount: false });
  try {
    const r = await sendOtp({ phone: parsed.data.phone, purpose: 'login', ipAddress: clientIp(req.headers) ?? undefined });
    return Response.json({ testAccount: true, ...r });
  } catch (e) {
    if (e instanceof OtpRateLimitedError) {
      return Response.json(
        { testAccount: true, error: e.message, retryAfter: e.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(e.retryAfterSeconds) } }
      );
    }
    return Response.json({ testAccount: true, error: (e as Error).message }, { status: 400 });
  }
}
