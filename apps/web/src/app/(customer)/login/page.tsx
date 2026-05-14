import { LoginClient, type LoginRole } from './login-client';
import { prisma } from '@/server/db';

export const metadata = { title: 'Sign in' };

const VALID_ROLES: LoginRole[] = ['customer', 'rider', 'staff', 'super'];

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
  const role: LoginRole = VALID_ROLES.includes(sp.role as LoginRole)
    ? (sp.role as LoginRole)
    : 'customer';

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
      restaurantsLive={restaurantsLive}
      cuisinesCount={cuisinesCount}
    />
  );
}
