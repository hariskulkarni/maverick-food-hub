import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authEdgeConfig } from '@/server/auth.config';

const { auth } = NextAuth(authEdgeConfig);

const ROLE_GATES: { prefix: string; roles: string[] }[] = [
  { prefix: '/platform', roles: ['SUPER_ADMIN'] },
  { prefix: '/admin', roles: ['ADMIN'] },
  { prefix: '/kitchen', roles: ['KITCHEN', 'ADMIN'] },
  { prefix: '/rider', roles: ['RIDER'] },
  { prefix: '/profile', roles: ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER', 'SUPER_ADMIN'] },
  { prefix: '/orders', roles: ['CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER'] }
];

/**
 * Paths a RIDER is allowed to visit. Everything else (customer home `/`, `/r/<slug>`,
 * `/cart`, `/checkout`, customer `/profile`, `/orders`, etc.) bounces to `/rider`.
 * The Capacitor WebView opens `/rider` directly, but reloads / deep-links could
 * land the rider on a customer surface — strict isolation closes that gap.
 */
function isRiderAllowedPath(path: string): boolean {
  if (path === '/rider' || path.startsWith('/rider/')) return true;
  if (path.startsWith('/api/rider/')) return true;
  if (path.startsWith('/api/auth/')) return true;
  if (path === '/login' || path.startsWith('/login/') || path.startsWith('/login?')) return true;
  if (path.startsWith('/_next/')) return true;
  // Static assets — favicons, PWA manifest, icons, service worker, robots.
  if (path === '/favicon.ico' || path === '/robots.txt' || path === '/sitemap.xml') return true;
  if (path === '/manifest.json' || path === '/manifest.webmanifest') return true;
  if (path === '/sw.js' || path === '/service-worker.js') return true;
  if (/\.(png|jpg|jpeg|svg|gif|webp|ico|css|js|map|woff2?|ttf|otf|txt)$/i.test(path)) return true;
  return false;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;

  // Allow auth callback / login early — nothing role-specific applies here.
  if (path.startsWith('/api/auth') || path === '/login' || path.startsWith('/login/')) {
    return NextResponse.next();
  }

  const gate = ROLE_GATES.find((g) => path.startsWith(g.prefix));

  // Even when the URL isn't gated, we still want to check whether a RIDER is
  // wandering onto a customer surface and bounce them back.
  if (!gate) {
    const session = await auth();
    if (session?.user && String(session.user.role) === 'RIDER' && !isRiderAllowedPath(path)) {
      return NextResponse.redirect(new URL('/rider', url));
    }
    return NextResponse.next();
  }

  const session = await auth();
  if (!session?.user || !session.user.role) {
    const loginUrl = new URL('/login', url);
    loginUrl.searchParams.set('next', path);
    return NextResponse.redirect(loginUrl);
  }

  const role = String(session.user.role);

  // Rider isolation: a signed-in RIDER on anything not allow-listed → /rider.
  // (Their own `/rider/*` paths pass the gate below normally.)
  if (role === 'RIDER' && !isRiderAllowedPath(path)) {
    return NextResponse.redirect(new URL('/rider', url));
  }

  if (!gate.roles.includes(role)) {
    return NextResponse.redirect(new URL('/', url));
  }
  return NextResponse.next();
}

export const config = {
  // Matcher covers gated prefixes plus customer surfaces a RIDER might land on
  // (`/`, `/r/<slug>`, `/cart`, `/checkout`). Static assets and `/_next` are
  // excluded so they never hit the auth lookup.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|service-worker.js|robots.txt|sitemap.xml).*)'
  ]
};
