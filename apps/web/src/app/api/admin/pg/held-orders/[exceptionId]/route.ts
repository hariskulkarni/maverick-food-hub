import { z } from 'zod';
import { audit } from '@/server/audit';
import { requirePgRestaurantAdmin } from '@/server/pg/admin-access';
import { HeldReleaseError, decideHeldRelease } from '@/server/pg/fulfillment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['CONFIRM', 'DECLINE']), note: z.string().trim().max(500).optional() });

/**
 * Restaurant ADMIN confirms or declines a paid order held for confirmation (stale release P1-6, or a
 * late payment accepted by two platform admins P1-2). Tenant guard: the exception must belong to the
 * caller's active restaurant (else 404).
 */
export async function POST(req: Request, { params }: { params: Promise<{ exceptionId: string }> }) {
  const gate = await requirePgRestaurantAdmin();
  if (gate instanceof Response) return gate;
  const { session, restaurant } = gate;
  const { exceptionId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Choose confirm or decline.' }, { status: 400 });
  try {
    const out = await decideHeldRelease({ exceptionId, restaurantId: restaurant.id, actorId: session.user.id, decision: parsed.data.decision, note: parsed.data.note });
    await audit(`pg.held_order.${out.decision.toLowerCase()}`, {
      actorId: session.user.id,
      actorRole: session.user.role,
      restaurantId: restaurant.id,
      entityType: 'PgReconException',
      entityId: exceptionId,
      after: { ...out },
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof HeldReleaseError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
