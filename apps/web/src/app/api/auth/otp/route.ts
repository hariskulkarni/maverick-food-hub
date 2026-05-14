import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sendOtp, OtpRateLimitedError } from '@/server/otp';

const Body = z.object({ phone: z.string().min(8).max(20), purpose: z.string().optional() });

function clientIp(req: NextRequest): string | undefined {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim();
  return req.headers.get('x-real-ip') ?? undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = Body.parse(await req.json());
    const r = await sendOtp({ phone: body.phone, purpose: body.purpose, ipAddress: clientIp(req) });
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
