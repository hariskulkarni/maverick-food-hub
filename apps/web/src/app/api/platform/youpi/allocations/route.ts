import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { proposeManualAllocation } from '@/server/pg/reconcile-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  attemptId: z.string().min(1).max(64),
  bankTransactionId: z.string().min(1).max(64),
  reason: z.string().trim().min(1).max(1000),
});

/** SUPER_ADMIN step 1 of dual-control manual allocation (proposal is an append-only event). */
export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Attempt, bank transaction and reason are required.' }, { status: 400 });
  try {
    const out = await proposeManualAllocation({ ...parsed.data, operatorId: gate.user.id });
    await audit('pg.allocation.propose', {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'PgFinancialEvent',
      entityId: out.proposalId,
      after: { ...parsed.data },
    });
    return Response.json({ ok: true, ...out }, { status: 201 });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
