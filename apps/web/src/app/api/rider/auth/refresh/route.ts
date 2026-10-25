/**
 * POST /api/rider/auth/refresh  (Bearer)
 *
 * Slides a live rider session forward (P1-11). A v2 token keeps its session
 * id and gets a fresh 7-day expiry; a legacy (pre-session) token from an older
 * build is upgraded by starting a server session. A revoked/expired/invalid
 * token → 401 session_expired, and the app returns to the login screen.
 *
 * 200: { token, expiresAt }
 */
import { NextRequest } from 'next/server';
import { readRiderBearer, signRiderToken, sessionExpiredResponse } from '@/server/rider-auth';
import { startSession } from '@/server/sessions';
import { clientIp } from '@/server/http/client-ip';
import { rateLimit } from '@/server/http/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { name: 'rider-token-refresh', limit: 30, windowMs: 60_000 });
  if (!rl.ok) return rl.response;
  const bearer = await readRiderBearer();
  if (bearer.kind !== 'valid') return sessionExpiredResponse();
  let sid = bearer.claims.sid;
  if (!sid) {
    sid = await startSession(bearer.user.id, { userAgent: req.headers.get('user-agent'), ipAddress: clientIp(req.headers) });
    if (!sid) return Response.json({ error: 'Could not refresh the session. Please try again.' }, { status: 503 });
  }
  const { token, expiresAt } = signRiderToken(bearer.user.id, sid);
  return Response.json({ token, expiresAt: expiresAt.toISOString() });
}
