import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sendOtp, OtpRateLimitedError } from '@/server/otp';
import { parseJsonBody } from '@/server/http/validate';
import { rateLimit } from '@/server/http/rate-limit';

const Body = z.object({ phone: z.string().min(8).max(20), purpose: z.string().max(40).optional() });

function clientIp(req: NextRequest): string | undefined {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim();
  return req.headers.get('x-real-ip') ?? undefined;
}

export async function POST(req: NextRequest) {
  // Coarse per-IP edge limit in front of the fine-grained per-phone/per-IP
  // limits inside sendOtp() — stops abusive bursts before they touch the DB.
  const rl = await rateLimit(req, { name: 'otp-send', limit: 10, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const parsed = await parseJsonBody(req, Body);
  if (!parsed.ok) return parsed.response;
  try {
    const r = await sendOtp({ phone: parsed.data.phone, purpose: parsed.data.purpose, ipAddress: clientIp(req) });
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
