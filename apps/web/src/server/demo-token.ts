/**
 * Stateless HMAC-signed tokens for the demo magic-link gate. No DB lookup
 * needed to verify — just an HMAC over `{email, exp}` with `demoSecret()`.
 *
 * We don't use the `jsonwebtoken` lib here to keep the dep surface tiny —
 * `crypto` is built into Node. Token format:
 *
 *   base64url(payload).base64url(signature)
 *
 * where payload = JSON({email, exp}) and signature = HMAC-SHA256(payload).
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';
import { demoSecret, DEMO_GATE_TTL_SECONDS } from '@/lib/demo';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}
function unb64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
function hmac(payload: string): string {
  return createHmac('sha256', demoSecret()).update(payload).digest('base64url');
}

export interface DemoTokenPayload {
  email: string;
  exp: number; // unix seconds
}

/** Sign a fresh access token for an email. TTL defaults to 24h. */
export function signDemoToken(email: string, ttlSeconds = DEMO_GATE_TTL_SECONDS): string {
  const payload: DemoTokenPayload = {
    email: email.trim().toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const head = b64url(JSON.stringify(payload));
  return `${head}.${hmac(head)}`;
}

/** Verify a token. Returns the payload on success, null on any failure. */
export function verifyDemoToken(token: string): DemoTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const head = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(head);
  // Constant-time compare to dodge timing attacks.
  const a = unb64url(sig);
  const b = unb64url(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64url(head).toString('utf8')) as DemoTokenPayload;
    if (typeof payload.email !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
    return payload;
  } catch {
    return null;
  }
}
