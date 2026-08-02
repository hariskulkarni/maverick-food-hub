import { headers } from 'next/headers';
import { LoginClient, type LoginRole } from './login-client';
import { prisma } from '@/server/db';
import { isPortalHost, hostSplitActive } from '@/server/hosts';

export const metadata = { title: 'Sign in' };

const VALID_ROLES: LoginRole[] = ['customer', 'staff', 'super'];

/**
 * Central /login page. Server component — fetches platform stats for the
 * marketing panel (restaurants live + distinct cuisines) and hands them to
 * the client component along with the parsed `?next=` / `?role=` query
 * params. All interactive state (role selection, form state, routing) lives
 * inside <LoginClient>.
 */
export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; role?: string }>;
}) {
  const sp = await searchParams;

  // Which surface is this? On flavrly.in only customers sign in; on
  // portal.flavrly.in only staff + super. On localhost / raw IP the split is
  // inactive, so all roles show (unchanged dev behaviour).
  const host = (await headers()).get('host');
  const surface: 'customer' | 'portal' | 'all' =
    !hostSplitActive(host) ? 'all' : isPortalHost(host) ? 'portal' : 'customer';

  let role: LoginRole = VALID_ROLES.includes(sp.role as LoginRole)
    ? (sp.role as LoginRole)
    : 'customer';
  // Clamp the requested role to what this surface allows.
  if (surface === 'customer') role = 'customer';
  else if (surface === 'portal' && role === 'customer') role = 'staff';

  const [restaurantsLive, distinctCuisines] = await Promise.all([
    prisma.restaurant.count({ where: { status: 'ACTIVE' } }),
    prisma.restaurant.findMany({
      where: { status: 'ACTIVE', cuisine: { not: null } },
      distinct: ['cuisine'],
      select: { cuisine: true }
    })
  ]);

  const cuisinesCount = distinctCuisines.filter((r) => !!r.cuisine).length;

  return (
    <LoginClient
      next={sp.next}
      initialRole={role}
      surface={surface}
      restaurantsLive={restaurantsLive}
      cuisinesCount={cuisinesCount}
    />
  );
}
