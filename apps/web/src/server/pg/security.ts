/**
 * Flavrly PG security validators (Agent G).
 *
 * Gateway base-URL validation against SSRF. The documented production topology
 * (docs/YOUPI-SELF-HOST.md) calls the gateway over loopback
 * (`http://127.0.0.1:6100`), so loopback is permitted only when explicitly
 * enabled with FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY=true. Everything else must be a
 * public https host in production.
 *
 * Rules:
 *  - http(s) only; https required in production except for an allowed loopback host.
 *  - No credentials, query string or fragment in the base URL.
 *  - Never: unspecified (0.0.0.0/8, ::), link-local (169.254/16 incl. cloud metadata,
 *    fe80::/10), multicast/reserved.
 *  - Loopback (127/8, ::1, localhost): only with FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY=true.
 *  - Private / CGNAT / ULA / benchmark ranges: only outside production with
 *    FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY=true.
 *  - DNS names are resolved and EVERY address must pass the same rules.
 *
 * Save-time validation does not stop DNS rebinding at fetch time. Callers that
 * fetch the gateway must also pass `redirect: 'error'` (GATEWAY_FETCH_REDIRECT).
 */
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export const GATEWAY_FETCH_REDIRECT = 'error' as const;

export type AddressClass = 'public' | 'loopback' | 'private' | 'forbidden';

export type GatewayUrlResult = { ok: true; url: string } | { ok: false; error: string };

export interface GatewayUrlEnv {
  NODE_ENV?: string;
  FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY?: string;
  FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY?: string;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const defaultResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function inV4(ip: number, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

function classifyV4(addr: string): AddressClass {
  const ip = ipv4ToInt(addr);
  if (['0.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4'].some((c) => inV4(ip, c))) return 'forbidden';
  if (inV4(ip, '127.0.0.0/8')) return 'loopback';
  if (
    ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '198.18.0.0/15', '192.0.0.0/24', '192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24'].some((c) =>
      inV4(ip, c),
    )
  )
    return 'private';
  return 'public';
}

/** Expands an IPv6 literal to 8 hextets (handles `::` and an embedded IPv4 tail). */
function expandV6(addr: string): number[] {
  let s = addr.toLowerCase().split('%')[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => parseInt(x || '0', 16));
}

function classifyV6(addr: string): AddressClass {
  const w = expandV6(addr);
  if (w.every((x) => x === 0)) return 'forbidden'; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return 'loopback'; // ::1
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96, 64:ff9b:1::/48):
  // judge by the embedded IPv4 address.
  const mapped = w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0);
  const nat64 = w[0] === 0x64 && w[1] === 0xff9b;
  if (mapped || nat64) {
    if (nat64 && w[2] === 1) return 'private'; // 64:ff9b:1::/48 local-use
    return classifyV4(`${w[6] >> 8}.${w[6] & 0xff}.${w[7] >> 8}.${w[7] & 0xff}`);
  }
  if ((w[0] & 0xffc0) === 0xfe80) return 'forbidden'; // link-local
  if ((w[0] & 0xff00) === 0xff00) return 'forbidden'; // multicast
  if ((w[0] & 0xfe00) === 0xfc00) return 'private'; // ULA fc00::/7
  if (w[0] === 0x2001 && w[1] === 0x0db8) return 'private'; // documentation
  return 'public';
}

export function classifyAddress(addr: string): AddressClass {
  const fam = isIP(addr);
  if (fam === 4) return classifyV4(addr);
  if (fam === 6) return classifyV6(addr);
  return 'forbidden';
}

function allowed(cls: AddressClass, env: GatewayUrlEnv): boolean {
  if (cls === 'public') return true;
  if (cls === 'loopback') return env.FLAVRLY_PG_ALLOW_LOOPBACK_GATEWAY === 'true';
  if (cls === 'private') return env.NODE_ENV !== 'production' && env.FLAVRLY_PG_ALLOW_PRIVATE_GATEWAY === 'true';
  return false;
}

/**
 * Validates and normalises a gateway base URL. Error messages never contain the
 * submitted URL (it may carry credentials).
 */
export async function validateGatewayBaseUrl(
  raw: string,
  env: GatewayUrlEnv = process.env,
  resolve: Resolver = defaultResolver,
): Promise<GatewayUrlResult> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: 'Gateway base URL is not a valid URL.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'Gateway base URL must use https.' };
  if (u.username || u.password) return { ok: false, error: 'Gateway base URL must not contain credentials.' };
  if (u.search || u.hash) return { ok: false, error: 'Gateway base URL must not contain a query string or fragment.' };

  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else if (host === 'localhost' || host.endsWith('.localhost')) {
    addresses = ['127.0.0.1'];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      return { ok: false, error: 'Gateway host could not be resolved.' };
    }
    if (addresses.length === 0) return { ok: false, error: 'Gateway host could not be resolved.' };
  }

  const classes = addresses.map(classifyAddress);
  if (!classes.every((c) => allowed(c, env))) {
    return { ok: false, error: 'Gateway host resolves to a private, loopback or link-local address that is not allowed.' };
  }
  const allLoopback = classes.every((c) => c === 'loopback');
  if (env.NODE_ENV === 'production' && u.protocol !== 'https:' && !allLoopback) {
    return { ok: false, error: 'Gateway base URL must use https.' };
  }
  return { ok: true, url: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}` };
}

