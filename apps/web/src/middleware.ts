import { NextResponse, type NextRequest } from 'next/server';
import NextAuth from 'next-auth';
import { authEdgeConfig } from '@/server/auth.config';

const { auth } = NextAuth(authEdgeConfig);

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
  return NextResponse.next();
}

export const config = {
  // Matcher covers the gated prefixes. Static assets and `/_next` are
  // excluded so they never hit the auth lookup.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|service-worker.js|robots.txt|sitemap.xml).*)'
  ]
};
