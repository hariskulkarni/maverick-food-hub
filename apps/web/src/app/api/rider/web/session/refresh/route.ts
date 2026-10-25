/**
 * POST /api/rider/web/session/refresh — slide the portal session forward.
 *
 * Delegates to the native app's POST /api/rider/auth/refresh (which now reads
 * the rider cookie through rider-auth when there is no Bearer header) and
 * re-sets the cookie with the fresh 7-day token. 401 session_expired clears it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { POST as refresh } from '@/app/api/rider/auth/refresh/route';
import { RIDER_COOKIE, riderCookieOptions } from '@/server/rider-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const res = await refresh(req);
  const body = (await res.json().catch(() => null)) as { token?: string; expiresAt?: string; error?: string } | null;
  if (!res.ok || !body?.token || !body.expiresAt) {
    const out = NextResponse.json(body ?? { error: 'session_expired' }, { status: res.status === 200 ? 500 : res.status });
    if (res.status === 401) out.cookies.set(RIDER_COOKIE, '', { ...riderCookieOptions(new Date(0)), maxAge: 0 });
    return out;
  }
  const out = NextResponse.json({ expiresAt: body.expiresAt });
  out.cookies.set(RIDER_COOKIE, body.token, riderCookieOptions(new Date(body.expiresAt)));
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
