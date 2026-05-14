/**
 * GET /api/customer/me
 *
 * Returns the signed-in customer's basic profile bundle.
 * Used by the tenant-scoped "My account" page (and any future header avatar
 * surface) to fetch a small, stable shape independently of the slug-scoped
 * bundle in /api/customer/me/[slug].
 *
 * Auth: any signed-in user. We don't gate by role here — staff also have a
 * user record and may want to see their own profile — but the customer
 * dashboard page itself does enforce role=CUSTOMER.
 */
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, phone: true, email: true, avatarUrl: true, role: true, createdAt: true }
  });

  if (!user) return new Response('Not found', { status: 404 });

  return Response.json({ user });
}
