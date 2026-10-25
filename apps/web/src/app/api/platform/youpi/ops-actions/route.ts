import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { proposeOpsAction } from '@/server/pg/ops-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum(['LATE_ACCEPT', 'ATTEMPT_VOID', 'REVERSAL']),
  attemptId: z.string().min(1).max(64).optional(),
  bankTransactionId: z.string().min(1).max(64).optional(),
  reason: z.string().trim().min(1).max(1000),
});

/** SUPER_ADMIN step 1 of a dual-control ops action (accept late payment, void attempt, bank reversal). */
export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Action, target and reason are required.' }, { status: 400 });
  const { action, attemptId, bankTransactionId, reason } = parsed.data;
  try {
    const out = await proposeOpsAction({ action, target: { attemptId, bankTransactionId }, actorId: gate.user.id, reason });
    await audit(`pg.${action.toLowerCase()}.propose`, {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'PgFinancialEvent',
      entityId: out.proposalId,
      after: { action, attemptId: attemptId ?? null, bankTransactionId: bankTransactionId ?? null, reason },
    });
    return Response.json({ ok: true, ...out }, { status: 201 });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
