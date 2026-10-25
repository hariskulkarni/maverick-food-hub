/**
 * Optional real-time Google Business Profile notifications via Cloud Pub/Sub
 * push. Polling (the 15-minute sweep) stays the source of truth; a verified
 * push just triggers an immediate sync for the affected restaurant.
 *
 * Verification (all required): RS256 signature against Google's published
 * OAuth2 certs (JWKS, cached 1h), iss = accounts.google.com, aud =
 * GBP_PUBSUB_AUDIENCE, not expired (60s skew), email_verified and email =
 * GBP_PUBSUB_SERVICE_ACCOUNT. Without both env vars the endpoint is disabled.
 */
import { createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/integrations';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SKEW_S = 60;

let certCache: { at: number; keys: Array<JsonWebKey & { kid?: string }> } | null = null;

export function _resetCertCache() { certCache = null; }

async function googleKeys(): Promise<Array<JsonWebKey & { kid?: string }>> {
  if (certCache && Date.now() - certCache.at < 3_600_000) return certCache.keys;
  const res = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`google certs ${res.status}`);
  const data = await res.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  certCache = { at: Date.now(), keys };
  return keys;
}

function b64urlJson(part: string): any {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function pubsubConfig(): { audience: string; serviceAccount: string } | null {
  const audience = process.env.GBP_PUBSUB_AUDIENCE;
  const serviceAccount = process.env.GBP_PUBSUB_SERVICE_ACCOUNT;
  return audience && serviceAccount ? { audience, serviceAccount } : null;
}

/** Returns true only for a valid Google-signed OIDC token for our audience + service account. */
export async function verifyPushToken(authorization: string | null, cfg: { audience: string; serviceAccount: string }, nowS = Math.floor(Date.now() / 1000)): Promise<boolean> {
  try {
    const m = /^Bearer\s+([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(authorization ?? '');
    if (!m) return false;
    const [, h, p, sig] = m;
    const header = b64urlJson(h);
    if (header?.alg !== 'RS256' || typeof header?.kid !== 'string') return false;
    const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(sig, 'base64url'));
    if (!ok) return false;
    const c = b64urlJson(p);
    if (!ISSUERS.has(c?.iss)) return false;
    const aud = Array.isArray(c?.aud) ? c.aud : [c?.aud];
    if (!aud.includes(cfg.audience)) return false;
    if (typeof c?.exp !== 'number' || c.exp + SKEW_S < nowS) return false;
    if (typeof c?.iat === 'number' && c.iat - SKEW_S > nowS) return false;
    if (c?.email_verified !== true || c?.email !== cfg.serviceAccount) return false;
    return true;
  } catch {
    return false;
  }
}

/** Parse the GBP notification carried in a Pub/Sub push body. */
export function parseNotification(body: any): { type: string; location: string; review: string | null } | null {
  try {
    const data = body?.message?.data;
    if (typeof data !== 'string') return null;
    const n = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    const location = typeof n?.location === 'string' ? n.location : '';
    if (!location) return null;
    return { type: String(n?.type ?? ''), location, review: typeof n?.review === 'string' ? n.review : null };
  } catch {
    return null;
  }
}

/** Connected restaurant whose selected location matches the notification's location. */
export async function restaurantForLocation(location: string): Promise<string | null> {
  const locSuffix = location.match(/locations\/[^/]+$/)?.[0];
  if (!locSuffix) return null;
  const creds = await prisma.integrationCredential.findMany({
    where: { provider: 'GOOGLE_BUSINESS' as any, status: 'CONNECTED' as any }, select: { restaurantId: true },
  });
  for (const { restaurantId } of creds) {
    const cfg = await getConfig(restaurantId, 'GOOGLE_BUSINESS' as any).catch(() => null);
    const loc = String(cfg?.locationId ?? '');
    if (loc && (loc === location || loc.endsWith(locSuffix))) return restaurantId;
  }
  return null;
}
