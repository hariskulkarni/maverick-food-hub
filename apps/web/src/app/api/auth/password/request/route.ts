/**
 * POST /api/auth/password/request  { email }
 * Always answers 200 {ok:true} — never reveals whether the account exists.
 */
import { NextRequest } from 'next/server';
import { rateLimit, clientIp } from '@/server/http/rate-limit';
import { requestPasswordReset } from '@/server/auth/password-reset';
import { log } from '@/server/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'pw-reset-req', limit: 5, windowMs: 900_000 });
  if (!rl.ok) return rl.response;

  let email = '';
  try {
    const body = await req.json();
    email = String(body?.email ?? '');
  } catch { /* neutral response regardless */ }

  if (email) {
    // Per-email cap (IP-independent) so a victim can't be email-bombed by rotating
    // source IPs. Trips silently: still 200, no send (no enumeration signal).
    const rlEmail = await rateLimit(req, {
      name: 'pw-reset-email', limit: 5, windowMs: 900_000,
      key: email.toLowerCase().trim(), ignoreIp: true,
    });
    if (!rlEmail.ok) return Response.json({ ok: true });
    // Fire-and-forget: response time must not reveal whether the account exists
    // (known accounts do DB writes + an email send; unknown ones return at once).
    const ip = clientIp(req);
    void Promise.resolve()
      .then(() => requestPasswordReset(email, ip))
      .catch((e) => log.error({ err: (e as Error).message }, 'password reset request failed'));
  }
  return Response.json({ ok: true });
}
