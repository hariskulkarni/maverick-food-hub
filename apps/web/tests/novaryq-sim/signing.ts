/**
 * Novaryq signing primitives, re-derived from CONTRACT §1 and Novaryq's
 * apps/api/src/dev-platform/signing.ts + webhooks/webhook-delivery.ts.
 *
 * Inbound partner request (Flavrly -> Novaryq):
 *   x-api-key   = clientId
 *   x-timestamp = unix seconds (Novaryq also accepts ms for the skew check)
 *   x-signature = hex(HMAC_SHA256(key = sha256hex(secret), `${ts}.${rawBody}`)), rawBody '' for GET
 *   rejected when |now - ts| > 300 s.
 *
 * Outbound webhook (Novaryq -> Flavrly):
 *   X-Novaryq-Signature = `t=<sec>,v1=<hex(HMAC_SHA256(key = subscription secret, `${t}.${rawBody}`))>`
 *   Note the asymmetry: the webhook key is the plaintext subscription secret, not its sha256.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SEC = 300;

export const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function computeApiSignature(signingKey: string, rawBody: string, ts: string | number): string {
  return createHmac('sha256', signingKey).update(`${ts}.${rawBody}`).digest('hex');
}

/** Headers a partner sends. `secret` is the plaintext nqsec_… secret. */
export function signRequest(clientId: string, secret: string, rawBody: string, nowSec = Math.floor(Date.now() / 1000)) {
  const ts = String(nowSec);
  return { 'x-api-key': clientId, 'x-timestamp': ts, 'x-signature': computeApiSignature(sha256hex(secret), rawBody, ts) };
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Mirrors Novaryq verifyApiSignature: returns the 401 reason, or null when valid. */
export function verifyApiSignature(
  signingKey: string,
  rawBody: string,
  tsHeader: string | undefined,
  sigHeader: string | undefined,
  nowMs = Date.now(),
): string | null {
  if (!tsHeader) return 'Missing x-timestamp header';
  if (!sigHeader) return 'Missing x-signature header';
  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return 'Malformed x-timestamp header';
  const tsSec = Math.abs(ts) > 1e11 ? Math.floor(ts / 1000) : ts;
  if (Math.abs(Math.floor(nowMs / 1000) - tsSec) > SIGNATURE_TOLERANCE_SEC) return 'Signature timestamp outside tolerance window';
  // HMAC over the exact timestamp string the client sent.
  if (!safeEqualHex(computeApiSignature(signingKey, rawBody, tsHeader), sigHeader)) return 'Signature mismatch';
  return null;
}

export function signWebhook(secret: string, rawBody: string, tSec: number): string {
  return `t=${tSec},v1=${createHmac('sha256', secret).update(`${tSec}.${rawBody}`).digest('hex')}`;
}

/** Reference receiver check (what Flavrly must do). Returns reason or null. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null | undefined, nowMs = Date.now()): string | null {
  if (!header) return 'missing signature';
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1) return 'malformed signature';
  if (Math.abs(Math.floor(nowMs / 1000) - t) > SIGNATURE_TOLERANCE_SEC) return 'stale signature';
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return safeEqualHex(expected, parts.v1) ? null : 'signature mismatch';
}
