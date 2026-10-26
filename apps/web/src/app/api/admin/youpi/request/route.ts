import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requirePgRestaurantAdmin } from '@/server/pg/admin-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Restaurant ADMIN requests the experimental Flavrly PG UPI feature (super-admin approves).
 * After a REJECT or DISABLE, a new request needs a super-admin RESET first (T-15).
 */
export async function POST() {
  const gate = await requirePgRestaurantAdmin();
  if (gate instanceof Response) return gate;
  const { session, restaurant } = gate;

  const existing = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId: restaurant.id } });
  if (existing?.status === 'APPROVED') {
    return Response.json({ error: 'Already approved', status: 'APPROVED' }, { status: 409 });
  }
  if (existing?.status === 'REQUESTED') {
    return Response.json({ status: 'REQUESTED' });
  }
  if (existing?.status === 'REJECTED' || existing?.status === 'DISABLED') {
    return Response.json(
      { error: 'The platform team must reset this decision before you can request again.', status: existing.status },
      { status: 409 },
    );
  }
  const now = new Date();
  const row = await prisma.youpiFeatureRequest.upsert({
    where: { restaurantId: restaurant.id },
    create: { restaurantId: restaurant.id, status: 'REQUESTED', requestedById: session.user.id, requestedAt: now },
    update: { status: 'REQUESTED', requestedById: session.user.id, requestedAt: now },
  });
  await audit('youpi.request', {
    actorId: session.user.id,
    actorRole: session.user.role,
    restaurantId: restaurant.id,
    entityType: 'YoupiFeatureRequest',
    entityId: row.id,
    before: existing ? { status: existing.status } : null,
    after: { status: row.status },
  });
  return Response.json({ status: row.status });
}
