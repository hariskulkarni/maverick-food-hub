import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authEdgeConfig } from '@/server/auth.config';

const { auth } = NextAuth(authEdgeConfig);

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
  if (path.startsWith('/api/auth') || path === '/login' || path.startsWith('/login/')) {
    return NextResponse.next();
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
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|service-worker.js|robots.txt|sitemap.xml).*)'
  ]
};
