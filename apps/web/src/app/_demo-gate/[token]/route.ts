/**
 * GET /_demo-gate/<token>
 *
 * Verifies the magic-link token; on success, sets the demo-gate cookie and
 * redirects the visitor to `/`. On failure (bad / expired token), redirects
 * back to `/_demo-gate` with an error flag.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyDemoToken } from '@/server/demo-token';
import { isDemoMode, DEMO_COOKIE_NAME, DEMO_GATE_TTL_SECONDS } from '@/lib/demo';
import { log } from '@/server/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!isDemoMode()) return new NextResponse('Not found', { status: 404 });

  const { token } = await params;
  const payload = verifyDemoToken(token);
  if (!payload) {
    return NextResponse.redirect(new URL('/_demo-gate?status=invalid', req.url));
  }

  log.info({ email: payload.email }, 'demo gate: access granted');

  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set(DEMO_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DEMO_GATE_TTL_SECONDS,
  });
  return res;
}
