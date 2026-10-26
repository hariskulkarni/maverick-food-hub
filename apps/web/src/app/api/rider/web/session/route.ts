/**
 * POST /api/rider/web/session — rider web portal sign-in (step 2).
 *
 * Thin cookie wrapper around the SAME sign-in code as the native app's
 * POST /api/rider/auth/verify-otp (verifyRiderOtp): it verifies the OTP,
 * enforces rider-only / suspended / deleted rules and starts a 'rider-web'
 * session — which supersedes only an older web session, never the app's. This route only moves the
 * resulting v2 token into an httpOnly, Secure, SameSite=Lax cookie so browser
 * JS never sees it. Step 1 (sending the code) is the existing
 * POST /api/rider/auth/request-otp, called directly by the portal.
 *
 * Body: { phone, code }   200: { rider, expiresAt }   errors: as verify-otp.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRiderOtp } from '@/server/rider-otp-login';
import { RIDER_COOKIE, riderCookieOptions, riderCookieRequestAllowed } from '@/server/rider-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Login-CSRF guard: only our own portal page may sign a browser in.
  if (!riderCookieRequestAllowed(req.headers)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }
  const res = await verifyRiderOtp(req, 'rider-web');
  const body = (await res.json().catch(() => null)) as
    | { token?: string; expiresAt?: string; rider?: unknown; error?: string }
    | null;
  if (!res.ok || !body?.token || !body.expiresAt) {
    return NextResponse.json(body ?? { error: 'Sign-in failed. Please try again.' }, { status: res.ok ? 500 : res.status });
  }
  const out = NextResponse.json({ rider: body.rider, expiresAt: body.expiresAt });
  out.cookies.set(RIDER_COOKIE, body.token, riderCookieOptions(new Date(body.expiresAt)));
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
