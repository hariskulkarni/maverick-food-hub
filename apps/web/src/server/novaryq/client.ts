/**
 * Novaryq partner-API client (CONTRACT §1/§2). Server-only.
 *
 * Every request is HMAC-signed:
 *   x-api-key   = clientId
 *   x-timestamp = unix seconds
 *   x-signature = hex(HMAC_SHA256(key = sha256hex(secret), `${ts}.${rawBody}`)), rawBody '' for GET
 *
 * Errors surface as NovaryqApiError with `retryable` (network, timeout, 401/403,
 * 408, 429, 5xx) and `retryAfterMs` (429 Retry-After). Redirects are never followed.
 */
import { createHash, createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const NOVARYQ_TIMEOUT_MS = 10_000;

export interface NovaryqCredentials {
  baseUrl: string;
  clientId: string;
  secret: string;
}

export class NovaryqApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'NovaryqApiError';
  }
}

export function signRequest(secret: string, rawBody: string, timestampSec: number): string {
  const key = createHash('sha256').update(secret).digest('hex');
  return createHmac('sha256', key).update(`${timestampSec}.${rawBody}`).digest('hex');
}

/** Retry-After as delta-seconds or an HTTP date, else the JSON `retryAfterSec`. */
export function parseRetryAfterMs(header: string | null, body: unknown): number | null {
  if (header) {
    const t = header.trim();
    if (/^\d+$/.test(t)) return Number(t) * 1000;
    const at = Date.parse(t);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const sec = (body as { retryAfterSec?: unknown } | null)?.retryAfterSec;
  return typeof sec === 'number' && Number.isFinite(sec) && sec >= 0 ? sec * 1000 : null;
}

/** Origin the admin pasted, without a trailing slash or `/api/v1`. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

function insecureAllowed(): boolean {
  return process.env.NOVARYQ_ALLOW_INSECURE_BASE_URL === 'true' && process.env.NODE_ENV !== 'production';
}

/**
 * Egress allow-list (QA-F1). IPv4: anything public (private, loopback, link-local, CGNAT,
 * benchmarking, documentation, multicast and reserved ranges are blocked). IPv6: only
 * global unicast 2000::/3, minus 6to4, Teredo and documentation — which also excludes
 * IPv4-mapped (::ffff:0:0/96), NAT64 (64:ff9b::/96), ULA, link-local and loopback.
 */
const BLOCKED_V4 = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED_V4.addSubnet(a, p, 'ipv4');
const GLOBAL_V6 = new net.BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
const BLOCKED_V6 = new net.BlockList();
for (const [a, p] of [['2002::', 16], ['2001::', 32], ['2001:db8::', 32]] as const) BLOCKED_V6.addSubnet(a, p, 'ipv6');

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return BLOCKED_V4.check(ip, 'ipv4');
  if (net.isIPv6(ip)) return !GLOBAL_V6.check(ip, 'ipv6') || BLOCKED_V6.check(ip, 'ipv6');
  return true;
}

/**
 * SSRF guard for the tenant-supplied base URL. Returns an error message or null.
 * https + public address only; NOVARYQ_ALLOW_INSECURE_BASE_URL=true (never in
 * production) admits http/localhost for a local simulator.
 */
export async function checkBaseUrl(
  raw: string,
  deps: { resolve?: (host: string) => Promise<string[]> } = {},
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(normalizeBaseUrl(raw));
  } catch {
    return 'Enter a valid Novaryq URL, e.g. https://app.novaryq.com';
  }
  if (url.username || url.password) return 'The Novaryq URL must not contain credentials.';
  if (insecureAllowed()) return url.protocol === 'https:' || url.protocol === 'http:' ? null : 'Use an http(s) URL.';
  if (url.protocol !== 'https:') return 'The Novaryq URL must use https.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const resolve = deps.resolve ?? (async (h: string) => (await lookup(h, { all: true })).map((a) => a.address));
  let addrs: string[];
  try {
    addrs = net.isIP(host) ? [host] : await resolve(host);
  } catch {
    return 'The Novaryq host could not be resolved.';
  }
  if (host === 'localhost' || addrs.length === 0 || addrs.some(isPrivateIp)) {
    return 'The Novaryq URL must point to a public host.';
  }
  return null;
}

export interface RequestOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** DNS resolver for the base-URL guard (tests inject one; default node:dns lookup). */
  resolve?: (host: string) => Promise<string[]>;
}

function retryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

export async function novaryqRequest<T = unknown>(
  creds: NovaryqCredentials,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<{ status: number; data: T }> {
  // Re-vetted on EVERY call (QA-F2): a URL saved under the dev escape hatch, or a host that
  // resolved public at save time and private now, is refused before anything is sent.
  // (No IP pinning: production is https-only, so a rebound target must also present a valid
  // certificate for the tenant's hostname before any request bytes are sent.)
  const bad = await checkBaseUrl(creds.baseUrl, { resolve: opts.resolve });
  if (bad) throw new NovaryqApiError(`Novaryq URL refused: ${bad}`, null, false);
  const rawBody = body === undefined ? '' : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'x-api-key': creds.clientId,
    'x-timestamp': String(ts),
    'x-signature': signRequest(creds.secret, rawBody, ts),
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const url = `${normalizeBaseUrl(creds.baseUrl)}/api/v1${path}`;
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : rawBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs ?? NOVARYQ_TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    const msg = name === 'TimeoutError' || name === 'AbortError' ? 'Novaryq request timed out' : `Novaryq unreachable: ${(e as Error)?.message ?? e}`;
    throw new NovaryqApiError(msg, null, true);
  }

  const text = await res.text().catch(() => '');
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status >= 200 && res.status < 300) return { status: res.status, data: data as T };

  const detail = (data as { message?: unknown } | null)?.message;
  const message = `Novaryq ${method} ${path.split('?')[0]} → HTTP ${res.status}${typeof detail === 'string' ? `: ${detail}` : Array.isArray(detail) ? `: ${detail.join('; ')}` : ''}`;
  throw new NovaryqApiError(
    message.slice(0, 500),
    res.status,
    retryableStatus(res.status),
    res.status === 429 ? parseRetryAfterMs(res.headers.get('retry-after'), data) : null,
    data,
  );
}
