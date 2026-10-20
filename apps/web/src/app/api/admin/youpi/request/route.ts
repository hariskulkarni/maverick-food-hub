import { requireManagedRestaurant } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Restaurant admin requests the experimental YouPI UPI feature (super-admin approves). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let restaurant;
  try {
    restaurant = await requireManagedRestaurant(body?.restaurantId ?? null);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const existing = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId: restaurant.id } });
  if (existing?.status === 'APPROVED') {
    return Response.json({ error: 'Already approved', status: 'APPROVED' }, { status: 409 });
  }
  if (existing?.status === 'REQUESTED') {
    return Response.json({ status: 'REQUESTED' });
  }
  const session = await auth();
  const now = new Date();
  const row = await prisma.youpiFeatureRequest.upsert({
    where: { restaurantId: restaurant.id },
    create: { restaurantId: restaurant.id, status: 'REQUESTED', requestedById: session?.user?.id ?? null, requestedAt: now },
    update: { status: 'REQUESTED', requestedById: session?.user?.id ?? null, requestedAt: now },
  });
  return Response.json({ status: row.status });
}
