/**
 * POST /api/rider/web/session/logout — sign the portal out.
 *
 * Delegates to POST /api/rider/auth/logout (revokes the server session, so the
 * token is dead everywhere, clears the push token, audits) and then expires
 * the cookie. Always 200.
 */
import { NextResponse } from 'next/server';
import { POST as logout } from '@/app/api/rider/auth/logout/route';
import { RIDER_COOKIE, riderCookieOptions } from '@/server/rider-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  await logout();
  const out = NextResponse.json({ ok: true });
  out.cookies.set(RIDER_COOKIE, '', { ...riderCookieOptions(new Date(0)), maxAge: 0 });
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
