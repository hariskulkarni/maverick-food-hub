import { prisma } from '@/server/db';
import { requirePgRestaurantAdmin } from '@/server/pg/admin-access';
import { ReceivingAccountError, requestVpaChange } from '@/server/pg/receiving-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Restaurant ADMIN requests a new receiving UPI VPA (threat model T-04).
 * This never changes the effective receiving VPA: the request waits until a platform super
 * admin creates and verifies a receiving account for it. KITCHEN and other roles are refused.
 * Audited (T-15).
 */
export async function POST(req: Request) {
  const gate = await requirePgRestaurantAdmin();
  if (gate instanceof Response) return gate;
  const { session, restaurant } = gate;

  const body = await req.json().catch(() => ({}));
  const fr = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId: restaurant.id } });
  if (fr?.status !== 'APPROVED') {
    return Response.json({ error: 'Flavrly PG is not approved for this restaurant' }, { status: 403 });
  }
  const receivingVpa = typeof body?.receivingVpa === 'string' ? body.receivingVpa.trim() : '';
  try {
    const out = await requestVpaChange(restaurant.id, receivingVpa, { id: session.user.id, role: session.user.role });
    return Response.json({ ok: true, status: 'PENDING_VERIFICATION', pendingReceivingVpa: out.pendingReceivingVpa });
  } catch (e) {
    if (e instanceof ReceivingAccountError) return Response.json({ error: e.message }, { status: e.httpStatus });
    throw e;
  }
}
