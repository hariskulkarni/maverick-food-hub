/**
 * Flavrly PG inbound webhook authentication helpers (contract D10).
 *
 * Wire formats we accept (both bind the timestamp into the MAC; a body-only
 * signature cannot stop a captured body being replayed under a fresh, unsigned
 * timestamp, so the legacy `X-Gateway-Signature` alone is NOT accepted):
 *
 *  - Standard Webhooks (Flavrly fork, webhooks v2): `webhook-id`,
 *    `webhook-timestamp` (epoch seconds), `webhook-signature` =
 *    space-separated `v1,<base64 HMAC-SHA256(key, "<id>.<ts>.<raw body>")>`,
 *    one entry per active secret. key = base64 bytes after `whsec_`, otherwise
 *    the secret's UTF-8 bytes. Retries are RE-SIGNED with a fresh timestamp and
 *    keep the same id.
 *  - Upstream YouPI d7b0741: `X-Gateway-Signature-V2` =
 *    `sha256=<hex HMAC-SHA256(utf8 secret, "<X-Gateway-Timestamp>.<raw body>")>`;
 *    the body repeats `deliveryId` and `timestamp`. Retries resend the ORIGINAL
 *    timestamp and body byte-for-byte (so a retry after >5 min is "stale").
 *
 * All comparisons are constant-time over equal-length buffers.
 */
import crypto from 'node:crypto';

export const MAX_WEBHOOK_BYTES = 64 * 1024;
export const MAX_SKEW_MS = 5 * 60 * 1000;
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

/** Reads at most `max` bytes. Returns null when the body is larger (checked before any HMAC work). */
export async function readBodyCapped(req: Request, max = MAX_WEBHOOK_BYTES): Promise<Buffer | null> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

/** Accepts epoch seconds, epoch millis, or an ISO date. Returns ms or null. */
export function parseTimestampMs(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return n < 1e12 ? n * 1000 : n;
  }
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export interface WebhookBodyIdentity {
  /** Delivery/event id carried INSIDE the signed body (upstream `deliveryId`, envelope `id`). */
  bodyDeliveryId: string | null;
  bodyTimestamp: string | null;
  bodyEventType: string | null;
  gatewayPaymentId: string | null;
  /** Gateway orderId = our attemptKey. */
  attemptKey: string | null;
  utr: string | null;
  amountPaise: number | null;
}

/** Extracts routing identity from either the legacy flat body or the v2 envelope. Pure. */
export function parseWebhookBody(body: unknown): WebhookBodyIdentity {
  type Obj = Record<string, unknown>;
  const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object';
  const b: Obj = isObj(body) ? body : {};
  const inner = isObj(b.data) && isObj(b.data.object) ? b.data.object : null;
  const envelope = inner !== null;
  const o: Obj = inner ?? b;
  const amount = o.amountPaise;
  return {
    bodyDeliveryId: envelope ? str(b.id) : str(b.deliveryId),
    bodyTimestamp: b.timestamp === undefined || b.timestamp === null ? null : String(b.timestamp),
    bodyEventType: envelope ? str(b.type) : str(b.event),
    gatewayPaymentId: envelope ? str(o.id) : str(o.paymentId),
    attemptKey: str(o.orderId),
    utr: str(o.utr),
    amountPaise: typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0 ? amount : null,
  };
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function keyBytes(secret: string): Buffer {
  return secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
}

export type VerifyResult =
  | { ok: true; scheme: 'standard' | 'v2'; deliveryId: string; timestampMs: number }
  | { ok: false; reason: 'no_secret' | 'unsupported_scheme' | 'missing_headers' | 'bad_signature' | 'bad_timestamp' };

/**
 * Verifies a timestamp-binding signature against any of `secrets`.
 * Does NOT check freshness or header/body consistency (caller does).
 */
export function verifyWebhookSignature(raw: Buffer, headers: Headers, secrets: string[]): VerifyResult {
  if (secrets.length === 0) return { ok: false, reason: 'no_secret' };

  const swSig = headers.get('webhook-signature');
  if (swSig !== null) {
    const id = (headers.get('webhook-id') ?? '').trim();
    const ts = (headers.get('webhook-timestamp') ?? '').trim();
    if (!id || !/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'missing_headers' };
    const given = swSig
      .split(' ')
      .filter((s) => s.startsWith('v1,'))
      .map((s) => Buffer.from(s.slice(3), 'base64'));
    const signed = Buffer.concat([Buffer.from(`${id}.${ts}.`, 'utf8'), raw]);
    for (const secret of secrets) {
      const mac = crypto.createHmac('sha256', keyBytes(secret)).update(signed).digest();
      if (given.some((g) => safeEqual(g, mac))) {
        return { ok: true, scheme: 'standard', deliveryId: id, timestampMs: Number(ts) * 1000 };
      }
    }
    return { ok: false, reason: 'bad_signature' };
  }

  const v2 = headers.get('x-gateway-signature-v2');
  if (v2 !== null) {
    const tsHeader = (headers.get('x-gateway-timestamp') ?? '').trim();
    const id = (headers.get('x-gateway-delivery-id') ?? '').trim();
    if (!tsHeader || !id) return { ok: false, reason: 'missing_headers' };
    const tsMs = parseTimestampMs(tsHeader);
    if (tsMs === null) return { ok: false, reason: 'bad_timestamp' };
    const given = Buffer.from(v2.trim().replace(/^sha256=/i, ''), 'utf8');
    const signed = Buffer.concat([Buffer.from(`${tsHeader}.`, 'utf8'), raw]);
    for (const secret of secrets) {
      const mac = Buffer.from(crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(signed).digest('hex'), 'utf8');
      if (safeEqual(given, mac)) return { ok: true, scheme: 'v2', deliveryId: id, timestampMs: tsMs };
    }
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: false, reason: 'unsupported_scheme' };
}

/**
 * Header/body identity consistency. Every id/timestamp/event that appears in
 * more than one place must agree; the signed-body copy must be present for v2
 * (its header delivery id is otherwise unauthenticated).
 */
export function identityMismatch(
  v: { scheme: 'standard' | 'v2'; deliveryId: string },
  headers: Headers,
  body: WebhookBodyIdentity,
): string | null {
  const headerDelivery = (headers.get('x-gateway-delivery-id') ?? '').trim();
  if (headerDelivery && headerDelivery !== v.deliveryId) return 'delivery_id_header';
  if (v.scheme === 'v2' && body.bodyDeliveryId !== v.deliveryId) return 'delivery_id_body';
  if (body.bodyDeliveryId && body.bodyDeliveryId !== v.deliveryId) return 'delivery_id_body';
  if (v.scheme === 'v2' && body.bodyTimestamp !== null &&
      body.bodyTimestamp !== (headers.get('x-gateway-timestamp') ?? '').trim()) return 'timestamp_body';
  const headerEvent = str(headers.get('x-gateway-event'));
  if (headerEvent && body.bodyEventType && headerEvent !== body.bodyEventType) return 'event_type';
  if (!body.gatewayPaymentId && !body.attemptKey) return 'no_payment_identity';
  return null;
}

/** Secrets to try for one credential: current, plus previous inside the rotation window. */
export function candidateSecrets(cfg: Record<string, string> | null | undefined, nowMs = Date.now()): string[] {
  if (!cfg) return [];
  const out: string[] = [];
  if (cfg.webhookSecret) out.push(cfg.webhookSecret);
  const rotatedAt = parseTimestampMs(cfg.webhookSecretRotatedAt ?? null);
  if (cfg.webhookSecretPrevious && rotatedAt !== null && nowMs < rotatedAt + ROTATION_GRACE_MS) {
    out.push(cfg.webhookSecretPrevious);
  }
  return out;
}
