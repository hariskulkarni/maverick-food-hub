/**
 * Claim a maintenance bypass.
 *
 *   GET /maintenance-bypass?t=<signed token>   → sets the bypass cookie
 *   GET /maintenance-bypass?clear=1            → drops it
 *
 * The token is minted by `npm run maintenance:on` and printed to the operator's
 * terminal. It is HMAC-signed with the session secret and carries its own
 * expiry, so it cannot be forged or extended, and it stops working on its own
 * even if the cookie is never cleared.
 *
 * A route handler rather than a page: it only sets a cookie and redirects, and
 * must work while the rest of the site is closed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/server/signed-token';
import {
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_BYPASS_SCOPE,
  UNDER_CONSTRUCTION_PATH,
} from '@/server/maintenance-paths';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  const secure = proto === 'https';

  /**
   * Build redirects from the HOST HEADER, never from `req.nextUrl`.
   *
   * Behind `next start` (and behind nginx), `req.nextUrl` reports the local
   * socket — 127.0.0.1:3000 — so `new URL('/', req.nextUrl)` would send the
   * operator to localhost and the bypass would appear broken in production
   * while working perfectly in dev. The host header is what the browser
   * actually asked for.
   *
   * The cookie is HOST-ONLY by design (no Domain attribute), so claiming the
   * bypass on flavrly.in does not unlock portal.flavrly.in: the same link has
   * to be opened on each hostname. That is the same deliberate isolation the
   * session cookies use — see server/hosts.ts.
   */
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  const here = (path: string) => new URL(path, `${proto}://${host}/`);

  if (url.searchParams.get('clear')) {
    const res = NextResponse.redirect(here(UNDER_CONSTRUCTION_PATH));
    res.cookies.delete(MAINTENANCE_BYPASS_COOKIE);
    return res;
  }

  const token = url.searchParams.get('t') ?? '';
  const payload = await verifyToken(token, { scope: MAINTENANCE_BYPASS_SCOPE });
  if (!payload) {
    // Deliberately vague, and lands on the holding page: an invalid or expired
    // token should look exactly like no token at all.
    const res = NextResponse.redirect(here(`${UNDER_CONSTRUCTION_PATH}?bypass=invalid`));
    res.cookies.delete(MAINTENANCE_BYPASS_COOKIE);
    return res;
  }

  // Land on `next` when it is a safe same-site path, else the home page.
  const rawNext = url.searchParams.get('next') ?? '/';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const res = NextResponse.redirect(here(next));
  res.cookies.set(MAINTENANCE_BYPASS_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    // Cookie dies with the token, so a stale cookie can never outlive its grant.
    expires: new Date(payload.exp * 1000),
  });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
