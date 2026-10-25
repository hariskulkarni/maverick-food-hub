import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { requeueDeadWebhook } from '@/server/pg/inbox';
import { requeueDeadOutbox } from '@/server/pg/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ type: z.enum(['outbox', 'webhook']), id: z.string().min(1).max(64) });

/**
 * SUPER_ADMIN requeues a dead outbox message or dead-lettered webhook (round-2 P1-5). Single actor,
 * audited: requeueing moves no money (handlers re-verify; capture still needs bank evidence).
 */
export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Type and id are required.' }, { status: 400 });
  try {
    const out =
      parsed.data.type === 'outbox'
        ? await requeueDeadOutbox({ id: parsed.data.id, actorId: gate.user.id })
        : await requeueDeadWebhook({ id: parsed.data.id, actorId: gate.user.id });
    await audit(`pg.dead_letter.requeue`, {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: parsed.data.type === 'outbox' ? 'PgOutbox' : 'PaymentWebhookEvent',
      entityId: parsed.data.id,
      after: { ...out },
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
