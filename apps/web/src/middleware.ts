import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authEdgeConfig } from '@/server/auth.config';

const { auth } = NextAuth(authEdgeConfig);

// ─────────────────────────── API rate limiting ───────────────────────────────
// In-memory fixed-window limiter. This deployment is a single long-lived
// `next start` process (pm2 fork), so module-level Maps persist across requests
// and are shared by every /api call. Covers ALL /api routes from one place:
//   • per-IP limit (flood / scraping / DoS protection)
//   • per-user limit (authenticated abuse) via the JWT session (no DB hit)
//   • a STRICT tier + exponential backoff for auth paths (brute force)
// Fail-open by design: any error here lets the request through — a limiter
// glitch must never take the whole API offline.
type RlBucket = { count: number; resetAt: number };
const RL_BUCKETS = new Map<string, RlBucket>();
const RL_AUTH_PENALTY = new Map<string, { until: number; strikes: number }>();
let RL_LAST_SWEEP = 0;

// Paths that must NOT be rate-limited: SSE stream, health probes, the demo gate,
// and any payment webhook (external, signature-verified, must not be dropped).
const RL_EXEMPT_PREFIX = ['/api/events', '/api/ready', '/api/system/health', '/api/demo-gate',
  '/api/auth/session', '/api/auth/csrf', '/api/auth/providers', '/api/auth/_log', '/api/auth/error'];

function rlHit(key: string, windowMs: number, now: number): number {
  const b = RL_BUCKETS.get(key);
  if (!b || b.resetAt <= now) { RL_BUCKETS.set(key, { count: 1, resetAt: now + windowMs }); return 1; }
  b.count += 1;
  return b.count;
}
function rlSweep(now: number): void {
  if (now - RL_LAST_SWEEP < 60_000) return;
  RL_LAST_SWEEP = now;
  for (const [k, b] of RL_BUCKETS) if (b.resetAt <= now) RL_BUCKETS.delete(k);
  for (const [k, pen] of RL_AUTH_PENALTY) if (pen.until <= now) RL_AUTH_PENALTY.delete(k);
}
function rlClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')?.trim()
    || 'unknown';
}
function rlTooMany(retryAfterSec: number): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
    { status: 429, headers: { 'content-type': 'application/json', 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' } },
  );
}
function rlIsAuthPath(p: string): boolean {
  return p.includes('/auth/') || /(login|signin|otp|verify|password|2fa)/i.test(p);
}

/**
 * CSRF defense-in-depth for the cookie-authenticated (browser) surface.
 * Rejects state-changing requests whose Origin doesn't match the host. Safe by
 * construction:
 *   • Bearer-token requests (native rider app) are skipped — not cookie-CSRF-able.
 *   • Requests with no Origin header (native/server clients) are allowed.
 *   • NextAuth (/api/auth) has its own CSRF token; webhooks are signature-verified.
 *   • Unparseable Origin → allowed (SameSite=Lax cookies still protect).
 */
function csrfGuard(req: NextRequest, path: string): NextResponse | null {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const authz = req.headers.get('authorization');
  if (authz && authz.startsWith('Bearer ')) return null;
  if (path.startsWith('/api/auth') || path.includes('/webhook')) return null;
  const origin = req.headers.get('origin');
  if (!origin) return null;
  try {
    if (new URL(origin).host !== req.headers.get('host')) {
      return new NextResponse(JSON.stringify({ error: 'Cross-origin request blocked.' }),
        { status: 403, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
    }
  } catch {
    return null;
  }
  return null;
}

async function apiRateLimit(req: NextRequest, path: string): Promise<NextResponse | null> {
  try {
    if (RL_EXEMPT_PREFIX.some((e) => path.startsWith(e)) || path.includes('/webhook')) return null;
    const now = Date.now();
    rlSweep(now);
    const ip = rlClientIp(req);
    const windowMs = 60_000;
    const authTier = rlIsAuthPath(path);

    // Exponential-backoff lockout window (auth paths only).
    if (authTier) {
      const pen = RL_AUTH_PENALTY.get(ip);
      if (pen && pen.until > now) return rlTooMany(Math.ceil((pen.until - now) / 1000));
    }

    // Per-IP window. Auth paths get a strict cap; on breach we escalate a
    // doubling cooldown (2s, 4s, 8s … capped at 15 min) to defeat brute force.
    const ipLimit = authTier ? 20 : 600;
    const ipCount = rlHit(`${authTier ? 'a' : 'g'}:ip:${ip}`, windowMs, now);
    if (ipCount > ipLimit) {
      if (authTier) {
        const pen = RL_AUTH_PENALTY.get(ip) ?? { until: 0, strikes: 0 };
        pen.strikes = Math.min(pen.strikes + 1, 12);
        const cooldownMs = Math.min(15 * 60_000, 1000 * Math.pow(2, pen.strikes));
        pen.until = now + cooldownMs;
        RL_AUTH_PENALTY.set(ip, pen);
        return rlTooMany(Math.ceil(cooldownMs / 1000));
      }
      return rlTooMany(Math.ceil(windowMs / 1000));
    }

    // Per-user window (authenticated, non-auth calls). JWT session → no DB hit.
    if (!authTier) {
      const session = await auth();
      const uid = session?.user?.id;
      if (uid) {
        const userCount = rlHit(`u:${uid}`, windowMs, now);
        if (userCount > 600) return rlTooMany(Math.ceil(windowMs / 1000));
      }
    }
    return null;
  } catch {
    return null; // fail-open
  }
}


const DEMO_COOKIE = 'flavrly_demo_gate';

// Authenticated app areas must NEVER be cached by the browser (bfcache),
// nginx, or Cloudflare — otherwise a super-admin can be served a pre-mutation
// snapshot (e.g. a restaurant still showing SUSPENDED) after it has changed.
// Next's force-dynamic pages already emit no-store, but we set it explicitly
// at the edge so it holds regardless of any CDN "Cache Everything" rule.
const NO_STORE = 'private, no-store, max-age=0, must-revalidate';
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', NO_STORE);
  res.headers.set('CDN-Cache-Control', NO_STORE); // Cloudflare / edge caches
  res.headers.set('Vary', 'Cookie');
  return res;
}


// ─── Edge-safe HMAC-SHA256 verify for the demo gate cookie ─────────
// We can't use node:crypto on the Edge runtime; Web Crypto works everywhere.
async function verifyDemoCookie(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const head = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const secret = process.env.DEMO_GATE_SECRET || process.env.NEXTAUTH_SECRET || '';
    if (!secret) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(head));
    // Compare base64url
    const macB64 = Buffer.from(new Uint8Array(macBuf)).toString('base64url');
    if (macB64 !== sig) return false;
    // Check expiry
    const payload = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
    if (typeof payload?.exp !== 'number') return false;
    return payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

const ROLE_GATES: { prefix: string; roles: string[] }[] = [
  { prefix: '/platform', roles: ['SUPER_ADMIN'] },
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/kitchen', roles: ['KITCHEN', 'ADMIN'] },
  { prefix: '/profile', roles: ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER', 'SUPER_ADMIN'] },
  { prefix: '/orders', roles: ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER'] }
];

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;

  // ─── Demo gate ─────────────────────────────────────────────────────────
  // When DEMO_MODE=true on this runtime, every page request needs a valid
  // signed gate cookie. The gate is intentionally a WEB-UI-only guard — it
  // exists so anonymous browser visitors land on a password form, not a
  // populated demo. API calls (rider native app, server-to-server webhooks)
  // and static assets (uploaded images, /public files, the rider APK) must
  // NOT be redirected — that breaks <img> rendering and rider login.
  //
  // IMPORTANT: the gate route is `/demo-gate`, NOT `/_demo-gate`. App Router
  // treats folders prefixed with `_` as private (not registered as routes),
  // so the underscore form 404s.
  if (process.env.DEMO_MODE === 'true') {
    const isGatePath =
      // The gate page + its API endpoint
      path.startsWith('/demo-gate') ||
      path.startsWith('/api/demo-gate') ||
      // Next.js asset pipeline + uploaded media
      path.startsWith('/_next') ||
      path.startsWith('/uploads/') ||
      path.startsWith('/downloads/') ||
      // Common static files served straight from /public
      path === '/favicon.ico' ||
      path === '/robots.txt' ||
      path === '/sitemap.xml' ||
      path === '/manifest.webmanifest' ||
      path === '/sw.js' ||
      path === '/llms.txt' ||
      /\.(?:png|jpg|jpeg|webp|gif|svg|ico|avif|mp4|webm|woff2?|ttf|otf|css|js|map|json|txt|xml|wasm)$/i.test(path) ||
      // API surface: the gate is a WEB-UI gate. Mobile clients (rider APK),
      // payment webhooks, and any cookie-less caller authenticate via Bearer
      // tokens / their own auth and must not be funnelled to a password form.
      path.startsWith('/api/');
    if (!isGatePath) {
      const cookie = req.cookies.get(DEMO_COOKIE)?.value;
      const ok = await verifyDemoCookie(cookie);
      if (!ok) {
        return NextResponse.redirect(new URL('/demo-gate', url));
      }
    }
  }

  // Allow auth callback / login early — nothing role-specific applies here.
  if (path === '/login' || path.startsWith('/login/')) {
    return NextResponse.next();
  }

  // Rate-limit every other /api route (IP + user + auth backoff). Pages fall
  // through to the role gates below.
  if (path.startsWith('/api/')) {
    const csrf = csrfGuard(req, path);
    if (csrf) return csrf;
    const limited = await apiRateLimit(req, path);
    return limited ?? NextResponse.next();
  }

  const gate = ROLE_GATES.find((g) => path.startsWith(g.prefix));
  if (!gate) {
    return NextResponse.next();
  }

  const session = await auth();
  if (!session?.user || !session.user.role) {
    const loginUrl = new URL('/login', url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  const role = String(session.user.role);

  // A user whose role isn't permitted on this gated prefix bounces to `/`.
  // (A RIDER-role user hitting a gated page just fails this check — riders
  // now use the separate native Android app.)
  if (!gate.roles.includes(role)) {
    return NextResponse.redirect(new URL('/', url));
  }
  // Passed the role gate — serve it, but flag it uncacheable so no proxy or
  // browser bfcache ever hands back a stale authenticated view.
  return noStore(NextResponse.next());
}

export const config = {
  // Matcher covers the gated prefixes. Static assets and `/_next` are
  // excluded so they never hit the auth lookup.
  matcher: [
    // NOTE: `api` is excluded so Next doesn't buffer (and 10MB-truncate) large
    // request bodies through middleware — critical for video uploads. API routes
    // do their own auth; the demo gate already exempts /api.
    '/((?!api/admin/upload|api/admin/menu/import|api/events|_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|service-worker.js|robots.txt|sitemap.xml).*)'
  ]
};
