/**
 * POST /api/customer/phone/verify  { phone, code }
 *
 * Verifies the phone OTP for the signed-in CUSTOMER and saves the number as
 * verified (server/customer-phone.ts → verifyCustomerPhone). Responses:
 *   200 { status: 'verified', phone }
 *   200 { status: 'link_available', ticket, maskedName, message } — the number
 *       belongs to an existing phone-only customer account; the client asks the
 *       customer to confirm, then signs in with the `phone-link` provider.
 *   409 { status: 'conflict', error, canSignInWithPhone }
 *   400 invalid phone / wrong or expired code;  403 not a customer.
 * The client refreshes /api/auth/session afterwards so the session cookie
 * carries the verified flag the middleware reads.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { rateLimit } from '@/server/http/rate-limit';
import { verifyCustomerPhone } from '@/server/customer-phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ phone: z.string().trim().max(20), code: z.string().trim().max(12) });

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'customer-phone-verify', limit: 20, windowMs: 60_000 });
  if (!rl.ok) return rl.response;

  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Please sign in again.' }, { status: 401 });
  if (session.user.role !== 'CUSTOMER') {
    return Response.json({ error: 'Only customer accounts can add a phone here.' }, { status: 403 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Enter your number and the 6-digit code.' }, { status: 400 });

  const r = await verifyCustomerPhone({ userId: session.user.id, phone: parsed.data.phone, code: parsed.data.code });
  switch (r.status) {
    case 'verified':
      return Response.json(r);
    case 'link_available':
      return Response.json(r);
    case 'conflict':
      return Response.json({ status: r.status, error: r.message, canSignInWithPhone: r.canSignInWithPhone }, { status: 409 });
    case 'forbidden':
      return Response.json({ status: r.status, error: r.message }, { status: 403 });
    default:
      return Response.json({ status: r.status, error: r.message }, { status: 400 });
  }
}
