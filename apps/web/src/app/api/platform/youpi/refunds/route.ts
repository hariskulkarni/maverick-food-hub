import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { requestPgRefund } from '@/server/pg/refunds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  attemptId: z.string().min(1).max(64),
  kind: z.enum(['ORDER', 'LATE_PAYMENT', 'OVERCOLLECTION']),
  amountPaise: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
  destinationRef: z.string().trim().max(120).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
});

/**
 * SUPER_ADMIN requests a manual bank refund of bank-confirmed money on an attempt (round-2 P1-1):
 * LATE_PAYMENT / OVERCOLLECTION credits (exception queue) or an ORDER payment of a cancelled order.
 * Dual control is unchanged: a DIFFERENT user approves, and completion needs the bank's refund
 * reference (merchant PG page, pg/refunds.ts). The pot check caps the amount at the allocated money.
 */
export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Attempt, refund kind, a positive amount (paise) and a reason are required.' }, { status: 400 });
  try {
    const out = await requestPgRefund({
      attemptId: parsed.data.attemptId,
      kind: parsed.data.kind,
      amountPaise: parsed.data.amountPaise,
      reason: parsed.data.reason,
      destinationRef: parsed.data.destinationRef ?? null,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      method: 'MANUAL_BANK',
      actor: { id: gate.user.id, role: gate.user.role },
    });
    await audit('pg.refund.request', {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'Refund',
      entityId: out.refundId,
      after: { attemptId: parsed.data.attemptId, kind: parsed.data.kind, amountPaise: parsed.data.amountPaise, replay: out.replay },
    });
    return Response.json({ ok: true, ...out }, { status: out.replay ? 200 : 201 });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
