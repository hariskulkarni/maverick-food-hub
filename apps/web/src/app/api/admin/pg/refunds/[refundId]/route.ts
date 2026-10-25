import { z } from 'zod';
import { requirePgRestaurantAdmin } from '@/server/pg/admin-access';
import { PgRefundError, approvePgRefund, completePgRefund, failPgRefund } from '@/server/pg/refunds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE') }),
  z.object({
    action: z.literal('COMPLETE'),
    bankReference: z.string().max(64).optional(),
    note: z.string().max(1000),
    attachmentRef: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal('FAIL'), reason: z.string().max(1000) }),
]);

/**
 * Restaurant ADMIN works a Flavrly PG refund of ITS restaurant (pg/refunds.ts, contract D13):
 * approve (must differ from the requester), complete with the bank's refund reference, or fail.
 * The tenant guard is pg/refunds' scopeRestaurantId (another restaurant's refund -> 404).
 */
export async function POST(req: Request, { params }: { params: Promise<{ refundId: string }> }) {
  const gate = await requirePgRestaurantAdmin();
  if (gate instanceof Response) return gate;
  const { session, restaurant } = gate;
  const { refundId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid refund action.' }, { status: 400 });
  const actor = { id: session.user.id, role: session.user.role };
  const scopeRestaurantId = restaurant.id;
  try {
    const b = parsed.data;
    const out =
      b.action === 'APPROVE'
        ? await approvePgRefund({ refundId, actor, scopeRestaurantId })
        : b.action === 'COMPLETE'
          ? await completePgRefund({
              refundId,
              bankReference: b.bankReference ?? null,
              evidence: { note: b.note, attachmentRef: b.attachmentRef ?? null },
              actor,
              scopeRestaurantId,
            })
          : await failPgRefund({ refundId, reason: b.reason, actor, scopeRestaurantId });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof PgRefundError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
