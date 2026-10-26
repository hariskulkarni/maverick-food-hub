/**
 * POST /api/auth/password/reset  { token, password }
 * 200 {ok:true, staffReenroll} | 400 {ok:false, reason}
 */
import { NextRequest } from 'next/server';
import { rateLimit } from '@/server/http/rate-limit';
import { consumePasswordReset } from '@/server/auth/password-reset';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'pw-reset-do', limit: 10, windowMs: 900_000 });
  if (!rl.ok) return rl.response;

  let token = '';
  let password = '';
  try {
    const body = await req.json();
    token = String(body?.token ?? '');
    password = String(body?.password ?? '');
  } catch { /* falls through to invalid */ }
  if (!token) return Response.json({ ok: false, reason: 'invalid' }, { status: 400 });

  const r = await consumePasswordReset(token, password);
  if (!r.ok) return Response.json({ ok: false, reason: r.reason }, { status: 400 });
  return Response.json({ ok: true, staffReenroll: r.staffReenroll });
}
