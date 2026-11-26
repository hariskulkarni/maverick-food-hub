/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Edge-safe signed tokens (HMAC-SHA256)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  Short-lived, tamper-evident tokens for gates that have to be checked in
 *  Edge middleware, where `node:crypto` is unavailable. Web Crypto works in
 *  the Edge runtime, in Node (18+) and under vitest, so one implementation
 *  serves middleware, route handlers and the CLI scripts alike.
 *
 *  Format:  base64url(JSON payload) "." base64url(HMAC-SHA256 of that text)
 *
 *  The payload is SIGNED, NOT ENCRYPTED — anyone can read it. Never put a
 *  secret in it. It carries only an expiry and a scope string.
 *
 *  This is the mechanism the demo gate already used inline; it is factored out
 *  here so the maintenance bypass uses exactly the same verified code path
 *  rather than a second, subtly different copy.
 */

export interface SignedPayload {
  /** Unix seconds. A token at or past this moment is rejected. */
  exp: number;
  /** What the token is for, e.g. 'maintenance-bypass'. Checked on verify. */
  scope?: string;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  // btoa is available in both Edge and Node.
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * Constant-time string compare. A fast `!==` on the MAC leaks, through timing,
 * how many leading bytes a forged signature got right — enough to forge one
 * byte at a time given sufficient attempts. Length is compared first and is
 * not secret (the MAC is always the same length).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The signing secret. Dedicated key if set, else the session secret. */
export function tokenSecret(): string {
  return process.env.GATE_TOKEN_SECRET || process.env.DEMO_GATE_SECRET || process.env.NEXTAUTH_SECRET || '';
}

/** Mint a token valid for `ttlSeconds`. Throws if no secret is configured. */
export async function signToken(
  payload: Omit<SignedPayload, 'exp'> & { exp?: number },
  ttlSeconds: number,
  secret: string = tokenSecret(),
): Promise<string> {
  if (!secret) {
    throw new Error('No signing secret available. Set NEXTAUTH_SECRET (or GATE_TOKEN_SECRET).');
  }
  const body: SignedPayload = {
    ...payload,
    exp: payload.exp ?? Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds)),
  };
  const head = b64urlEncode(new TextEncoder().encode(JSON.stringify(body)));
  return `${head}.${await hmac(secret, head)}`;
}

/**
 * Verify a token. Returns the payload, or null for anything wrong: bad shape,
 * bad signature, missing/expired `exp`, or a scope mismatch.
 *
 * Fails CLOSED on every error path, including a missing secret — a gate whose
 * secret vanished must not start admitting everyone.
 */
export async function verifyToken(
  token: string | undefined | null,
  opts: { scope?: string; secret?: string; now?: number } = {},
): Promise<SignedPayload | null> {
  if (!token) return null;
  const secret = opts.secret ?? tokenSecret();
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const head = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    if (!timingSafeEqual(await hmac(secret, head), sig)) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(head))) as SignedPayload;
    if (typeof payload?.exp !== 'number' || !Number.isFinite(payload.exp)) return null;
    const now = opts.now ?? Math.floor(Date.now() / 1000);
    if (payload.exp <= now) return null;
    if (opts.scope && payload.scope !== opts.scope) return null;
    return payload;
  } catch {
    return null;
  }
}
