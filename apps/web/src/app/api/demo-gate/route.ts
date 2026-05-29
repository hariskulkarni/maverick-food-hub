/**
 * POST /api/demo-gate
 *   body: { password: string }
 *   → checks the password against DEMO_GATE_PASSWORD (env). On success signs a
 *     24h token, sets it as the demo-gate cookie, and returns { ok, redirect }.
 *
 * No email is sent — the gate is a single shared password. Wrong / missing
 * password returns 401 with a generic message.
 *
 * Refuses to run when DEMO_MODE is off (no-op on prod).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { timingSafeEqual } from 'crypto';
import {
  isDemoMode,
  DEMO_COOKIE_NAME,
  DEMO_GATE_TTL_SECONDS,
} from '@/lib/demo';
import { signDemoToken } from '@/server/demo-token';
import { log } from '@/server/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ password: z.string().min(1).max(200) });

/** Constant-time string compare that won't crash on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Pad shorter to longer so timingSafeEqual doesn't throw; then also gate on length.
  const len = Math.max(ab.length, bb.length);
  const apad = Buffer.alloc(len);
  const bpad = Buffer.alloc(len);
  ab.copy(apad); bb.copy(bpad);
  return ab.length === bb.length && timingSafeEqual(apad, bpad);
}

export async function POST(req: NextRequest) {
  if (!isDemoMode()) {
    return new Response('Not found', { status: 404 });
  }

  const expected = process.env.DEMO_GATE_PASSWORD;
  if (!expected) {
    log.error({}, 'demo gate: DEMO_GATE_PASSWORD is not set');
    return Response.json({ error: 'Demo gate is not configured' }, { status: 500 });
  }

  let password: string;
  try {
    const parsed = Body.parse(await req.json());
    password = parsed.password;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (!safeEqual(password, expected)) {
    return Response.json({ error: 'Wrong password' }, { status: 401 });
  }

  // Sign a token. We use a generic visitor identifier — there's no email here.
  const token = signDemoToken('demo-visitor');

  const res = Response.json({ ok: true, redirect: '/' });
  res.headers.append(
    'Set-Cookie',
    [
      `${DEMO_COOKIE_NAME}=${token}`,
      `Path=/`,
      `Max-Age=${DEMO_GATE_TTL_SECONDS}`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Secure`,
    ].join('; '),
  );
  return res;
}
