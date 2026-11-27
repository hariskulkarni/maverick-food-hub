import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authEdgeConfig } from '@/server/auth.config';
import { verifyToken } from '@/server/signed-token';
import {
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_BYPASS_SCOPE,
  MAINTENANCE_STATUS_ENDPOINT,
  UNDER_CONSTRUCTION_PATH,
  isMaintenanceExemptPath,
  isMaintenanceInfraPath,
  loopbackStatusOrigin,
  wantsJsonMaintenanceResponse,
} from '@/server/maintenance-paths';
import { PLATFORM_ROLES, pageGateFor, can } from '@/server/permissions';
import { PUBLIC_HOST, PORTAL_HOST, isPortalHost, hostSplitActive, isStaffPath } from '@/server/hosts';
import { clientIp } from '@/server/http/client-ip';
import { csrfGuard, isWebhookPath } from '@/server/http/csrf';
import { isAuthRateLimitPath } from '@/server/http/rate-limit-paths';

const { auth } = NextAuth(authEdgeConfig);

// ───────────────────────── Maintenance / under-construction ─────────────────
// One switch closes the WHOLE platform — both hostnames, customers and staff
// alike, SUPER_ADMIN included. There is no product UI for it; it is flipped
// with `npm run maintenance:on|off` on the server (see server/maintenance.ts).
//
// Middleware runs on the Edge runtime and CANNOT query Prisma, so the flag is
// read over HTTP from /api/system/maintenance and cached in this module. The
// deployment is a single long-lived `next start` process (pm2 fork), so this
// cache is shared by every request, exactly like the rate-limit buckets below:
// one fetch per MAINT_TTL_MS, not one per request.
type MaintCache = { on: boolean; message: string | null; fetchedAt: number };
let MAINT_CACHE: MaintCache | null = null;
let MAINT_INFLIGHT: Promise<void> | null = null;
const MAINT_TTL_MS = 10_000;

/**
 * The flag, cached.
 *
 * A stale entry is refreshed SYNCHRONOUSLY rather than served stale while a
 * refresh runs in the background. Serve-stale would mean the first request
 * after the TTL lapses still sees the old value, so flipping the switch would
 * take "10 seconds, plus one unlucky request" — and the one request that slips
 * through is exactly the one you were trying to stop. The read is a loopback
 * fetch to this same process, so the cost of being correct is a fraction of a
 * millisecond once every 10 seconds.
 *
 * Fails OPEN in two distinct ways, both deliberate:
 *   • first fetch fails → `null` → treated as "site up". A gate that closed
 *     the site because it couldn't reach its own status endpoint would be an
 *     outage with no off switch.
 *   • later fetch fails → the last known value is kept and reused. A blip
 *     must not silently reopen a site that was closed on purpose.
 */
async function maintenanceState(req: NextRequest): Promise<MaintCache | null> {
  const now = Date.now();
  const fresh = MAINT_CACHE && now - MAINT_CACHE.fetchedAt < MAINT_TTL_MS;
  if (fresh) return MAINT_CACHE;

  if (!MAINT_INFLIGHT) {
    // Loopback, scheme forced to http -- see loopbackStatusOrigin() for why
    // deriving this from req.nextUrl silently disabled the whole gate in
    // production while passing every local test.
    const base = loopbackStatusOrigin(req.nextUrl, {
      MAINTENANCE_STATUS_ORIGIN: process.env.MAINTENANCE_STATUS_ORIGIN,
      PORT: process.env.PORT,
    });
    MAINT_INFLIGHT = fetch(`${base}${MAINTENANCE_STATUS_ENDPOINT}`, {
      cache: 'no-store',
      headers: { 'x-maintenance-probe': '1' },
      signal: AbortSignal.timeout(2_000),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        const j = (await r.json()) as { on?: boolean; message?: string | null };
        MAINT_CACHE = { on: j?.on === true, message: j?.message ?? null, fetchedAt: Date.now() };
      })
      .catch((err: unknown) => {
        // LOUDLY. Failing open in silence is how this gate spent a whole
        // production deploy doing nothing while reporting healthy. At most one
        // line per TTL, since there is at most one fetch per TTL.
        console.error(
          `[maintenance] status read failed from ${base} \u2014 failing ${MAINT_CACHE ? 'to last known state' : 'OPEN'}:`,
          err instanceof Error ? err.message : String(err),
        );
        // Keep the last known value; only mark it refreshed so a hard-down
        // status endpoint can't spin one fetch per request.
        if (MAINT_CACHE) MAINT_CACHE = { ...MAINT_CACHE, fetchedAt: Date.now() };
      })
      .finally(() => {
        MAINT_INFLIGHT = null;
      });
  }

  // Wait for the refresh. On failure the catch above has already restored the
  // previous value (or left it null), so we return whatever is known.
  await MAINT_INFLIGHT.catch(() => {});
  return MAINT_CACHE;
}

function maintenanceJson(): NextResponse {
  return new NextResponse(
    JSON.stringify({
      error: 'Flavrly is temporarily closed for maintenance. Please try again shortly.',
      code: 'service/maintenance',
    }),
    {
      status: 503,
      headers: {
        'content-type': 'application/json',
        'Retry-After': '600',
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * Gate every request while maintenance is on.
 *
 * Returns a response to serve, or null to let the request through. Runs BEFORE
 * the demo gate and the domain split: when the platform is closed, nothing
 * else about the request matters.
 */
async function maintenanceGate(req: NextRequest, path: string): Promise<NextResponse | null> {
  if (isMaintenanceExemptPath(path)) return null;

  const state = await maintenanceState(req);
  if (!state?.on) return null;

  // A valid, unexpired, correctly-scoped bypass token lets an operator through.
  const bypass = await verifyToken(req.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value, {
    scope: MAINTENANCE_BYPASS_SCOPE,
  });
  if (bypass) return null;

  if (wantsJsonMaintenanceResponse(path)) return maintenanceJson();

  // Rewrite (not redirect) so the visitor keeps the URL they asked for and
  // simply finds the site closed — and so a crawler sees 503 at that URL
  // rather than a 307 to a page that returns 200.
  const res = NextResponse.rewrite(new URL(UNDER_CONSTRUCTION_PATH, req.nextUrl), { status: 503 });
  res.headers.set('Retry-After', '600');
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('CDN-Cache-Control', 'no-store');
  return res;
}


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
  // C10: trust CF-Connecting-IP / X-Real-IP / the LAST XFF hop, never the
  // client-supplied first hop (which defeated this limiter and the auth backoff).
  return clientIp(req.headers) || 'unknown';
}
function rlTooMany(retryAfterSec: number): NextResponse {
  return new NextResponse(
    JSON.stringify({ error: 'Too many requests. Please slow down and try again shortly.' }),
    { status: 429, headers: { 'content-type': 'application/json', 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' } },
  );
}
const rlIsAuthPath = isAuthRateLimitPath;

async function apiRateLimit(req: NextRequest, path: string): Promise<NextResponse | null> {
  try {
    if (RL_EXEMPT_PREFIX.some((e) => path.startsWith(e)) || isWebhookPath(path)) return null;
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


const ASSET_RE = /\.(?:png|jpg|jpeg|webp|gif|svg|ico|avif|mp4|webm|woff2?|ttf|otf|css|js|map|json|txt|xml|wasm)$/i;

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

/**
 * Portal root (`portal.flavrly.in/`): bounce a signed-in staff user to their
 * dashboard, anyone else to the staff login. The session here only CHOOSES a
 * destination — it grants nothing; every destination is enforced by the role
 * gates below on the follow-up request.
 */
async function portalRootRedirect(): Promise<NextResponse> {
  const s = await auth();
  const r = s?.user?.role ? String(s.user.role) : null;
  const home =
      r === 'SUPER_ADMIN' ? '/platform'
    : r === 'ADMIN_ASSIST' || r === 'DEVELOPER' || r === 'QA' || r === 'GUEST' ? '/platform'
    : r === 'ADMIN'       ? '/admin'
    : r === 'KITCHEN'     ? '/kitchen'
    : '/login';
  return NextResponse.redirect(new URL(home, `https://${PORTAL_HOST}`));
}

const ROLE_GATES: { prefix: string; roles: string[] }[] = [
  { prefix: '/platform', roles: PLATFORM_ROLES as unknown as string[] },
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/kitchen', roles: ['KITCHEN', 'ADMIN'] },
  { prefix: '/profile', roles: ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER', 'SUPER_ADMIN'] },
  { prefix: '/orders', roles: ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER'] }
];

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;

  // ─── Maintenance gate ──────────────────────────────────────────────────
  // Checked before everything else: when the platform is closed, no other
  // routing decision matters.
  const closed = await maintenanceGate(req, path);
  if (closed) return closed;

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
    // Verify the gate cookie on EVERY request first: the (client-controlled)
    // path decides only whether a missing/invalid cookie is tolerated, never
    // whether verification runs at all.
    const demoGateOk = await verifyDemoCookie(req.cookies.get(DEMO_COOKIE)?.value);
    const isGatePath =
      // The gate page + its API endpoint
      path.startsWith('/demo-gate') ||
      path.startsWith('/api/demo-gate') ||
      // Next.js asset pipeline + uploaded media
      path.startsWith('/_next') ||
      path.startsWith('/uploads/') ||
      path.startsWith('/downloads/') ||
      // Rider app download route (streams the active APK; demo APKs too).
      path.startsWith('/download/') ||
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
    if (!demoGateOk && !isGatePath) {
      return NextResponse.redirect(new URL('/demo-gate', url));
    }
  }

  // ─── Domain split: customer site (flavrly.in) vs staff portal ──────────
  // One deployment, two hostnames. Enforce which surface serves which routes;
  // cross-surface requests bounce to the correct host. Skipped for /api, the
  // Next asset pipeline, the demo gate, and static files. Inactive on
  // localhost / the raw IP so dev + direct-origin health checks are unaffected.
  const hostHeader = req.headers.get('host');
  const onPortalHost = isPortalHost(hostHeader);

  // Redirect targets must be built from the real Host header: behind
  // `next start`, req.nextUrl reports the socket address (127.0.0.1:3000), so
  // new URL('/login', url) would bounce users to localhost. Use the forwarded
  // proto + Host when a split host is in play; fall back to the request URL for
  // dev / localhost / raw-IP.
  const fwdProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const selfBase: string | URL = hostSplitActive(hostHeader)
    ? `${fwdProto || 'https'}://${hostHeader}`
    : url;
  if (
    hostSplitActive(hostHeader) &&
    !path.startsWith('/api/') &&
    !path.startsWith('/_next') &&
    !path.startsWith('/demo-gate') &&
    // The holding page and the bypass-claim route are valid on BOTH hosts:
    // bypass cookies are host-only, so an operator must be able to claim one
    // on the portal without being bounced to the customer site.
    !isMaintenanceInfraPath(path) &&
    !ASSET_RE.test(path)
  ) {
    const isLoginPath = path === '/login' || path.startsWith('/login/');
    if (onPortalHost) {
      // Portal root → the signed-in user's dashboard, else the staff login.
      if (path === '/') return portalRootRedirect();
      // Portal serves ONLY staff areas + login. Anything else is a customer
      // page → send it to the public site (same path).
      if (!isStaffPath(path) && !isLoginPath) {
        return NextResponse.redirect(new URL(path + url.search, `https://${PUBLIC_HOST}`));
      }
    } else {
      // Public customer host: staff areas live on the portal → bounce there.
      if (isStaffPath(path)) {
        return NextResponse.redirect(new URL(path + url.search, `https://${PORTAL_HOST}`));
      }
    }
  }

  // Allow auth callback / login early — nothing role-specific applies here.
  if (path === '/login' || path.startsWith('/login/')) {
    const res = NextResponse.next();
    if (onPortalHost) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    return res;
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
    const loginUrl = new URL('/login', selfBase);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  const role = String(session.user.role);

  // A user whose role isn't permitted on this gated prefix bounces to `/`.
  // (A RIDER-role user hitting a gated page just fails this check — riders
  // now use the separate native Android app.)
  if (!gate.roles.includes(role)) {
    return NextResponse.redirect(new URL('/', selfBase));
  }

  // Customer phone gate: a CUSTOMER without an OTP-verified phone (e.g. fresh
  // from Google sign-in) is sent to the mandatory "Add your phone" step first,
  // returning here afterwards. Only an explicit `false` redirects: tokens minted
  // before the flag existed carry no value, and the APIs/pages re-check the
  // live DB state anyway (server/customer-phone.ts).
  if (role === 'CUSTOMER' && (session.user as { phoneVerified?: boolean }).phoneVerified === false) {
    const welcome = new URL('/welcome', selfBase);
    welcome.searchParams.set('next', path + url.search);
    welcome.searchParams.set('gate', '1');
    return NextResponse.redirect(welcome);
  }

  // Within the /platform console, enforce the per-surface capability gate so a
  // delegated platform role (Admin Assist / QA / Developer / Guest) only reaches
  // the areas its role grants. SUPER_ADMIN holds every capability. Unmapped
  // paths fall back to `platform:view`, which every platform role holds.
  if (path.startsWith('/platform')) {
    const needed = pageGateFor(path);
    if (!can(role, needed)) {
      return NextResponse.redirect(new URL('/platform', selfBase));
    }
  }

  // Passed the role gate — serve it, but flag it uncacheable so no proxy or
  // browser bfcache ever hands back a stale authenticated view. Portal (staff)
  // pages are also marked noindex so they never reach search engines.
  const gated = noStore(NextResponse.next());
  if (onPortalHost) gated.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return gated;
}

export const config = {
  // Matcher covers the gated prefixes. Static assets and `/_next` are
  // excluded so they never hit the auth lookup.
  matcher: [
    // NOTE: `api` is excluded so Next doesn't buffer (and 10MB-truncate) large
    // request bodies through middleware — critical for video uploads (and the
    // ≤200 MB rider APK upload, which does its own same-origin check). API routes
    // do their own auth; the demo gate already exempts /api.
    '/((?!api/admin/upload|api/platform/app-releases/upload|api/admin/menu/import|api/events|_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|push-sw.js|service-worker.js|robots.txt|sitemap.xml).*)'
  ]
};
