/**
 * POST /api/rider/auth/verify-otp
 *
 * Native rider app — step 2 of login. Confirms the account is a RIDER, verifies
 * the OTP, and issues a 30-day Bearer JWT the app stores in secure storage and
 * sends on every subsequent /api/rider/* request.
 *
 * Body: { phone: string, code: string }
 * 200:  { token: string, rider: { id, name, phone } }
 * 401:  { error: 'invalid_code' }
 * 403:  { error: 'not_a_rider' }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { verifyOtp } from '@/server/otp';
import { signRiderToken } from '@/server/rider-auth';
import { rateLimit } from '@/server/http/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().min(4).max(8)
});

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'rider-otp-verify', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  try {
    const { phone, code } = Body.parse(await req.json());

    // Role check first — so a non-rider hitting this directly never even
    // consumes an OTP token.
    const user = await prisma.user.findUnique({
      where: { phone },
      select: { id: true, name: true, phone: true, role: true }
    });
    if (!user || user.role !== 'RIDER') {
      return Response.json({ error: 'not_a_rider' }, { status: 403 });
    }

    const ok = await verifyOtp({ phone, code, purpose: 'login' });
    if (!ok) {
      return Response.json({ error: 'invalid_code' }, { status: 401 });
    }

    const token = signRiderToken(user.id);
    return Response.json({
      token,
      rider: { id: user.id, name: user.name ?? null, phone: user.phone ?? null }
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
