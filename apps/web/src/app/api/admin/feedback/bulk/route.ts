/**
 * POST /api/admin/feedback/bulk
 * Body: { ids: string[], action: 'hide' | 'unhide' }
 * Only rows belonging to the caller's managed restaurant are touched.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { moderationGate, statusData, refreshRiders } from '@/server/reviews/moderation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BULK = 100;

export async function POST(req: NextRequest) {
  const gate = await moderationGate(req.nextUrl?.searchParams?.get('restaurantId'));
  if (gate instanceof Response) return gate;
  const { userId, restaurant } = gate;

  const body = await req.json().catch(() => null);
  const ids: unknown = body?.ids;
  const action = body?.action;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK || !ids.every((x) => typeof x === 'string')) {
    return Response.json({ error: `ids must be 1-${MAX_BULK} strings` }, { status: 400 });
  }
  if (action !== 'hide' && action !== 'unhide') {
    return Response.json({ error: 'action must be hide or unhide' }, { status: 400 });
  }

  const owned = await (prisma as any).orderFeedback.findMany({
    where: { id: { in: ids }, order: { branch: { restaurantId: restaurant.id } } },
    select: { id: true, order: { select: { assignment: { select: { riderId: true } } } } }
  });
  const ownedIds: string[] = owned.map((r: any) => r.id);
  if (ownedIds.length === 0) return Response.json({ ok: true, updated: 0 });

  const res = await (prisma as any).orderFeedback.updateMany({
    where: { id: { in: ownedIds } },
    data: statusData(action, userId)
  });

  await audit('feedback.moderate', {
    actorId: userId,
    actorRole: 'ADMIN',
    restaurantId: restaurant.id,
    entityType: 'OrderFeedback',
    entityId: ownedIds.join(','),
    before: null,
    after: { action, ids: ownedIds, bulk: true }
  });

  await refreshRiders(owned.map((r: any) => r.order?.assignment?.riderId));

  return Response.json({ ok: true, updated: res.count ?? ownedIds.length });
}
