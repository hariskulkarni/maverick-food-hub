import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { approveManualAllocation } from '@/server/pg/reconcile-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * SUPER_ADMIN step 2: a DIFFERENT user approves; the engine (allocateBankCredit) refuses
 * self-approval and re-checks account, direction, currency, exact amount and status.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { proposalId } = await params;
  try {
    const out = await approveManualAllocation({ proposalId, approverId: gate.user.id });
    await audit('pg.allocation.approve', {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'PgFinancialEvent',
      entityId: proposalId,
      after: { outcome: out.outcome, allocationId: out.allocationId ?? null, reason: out.reason ?? null },
    });
    return Response.json({ ok: out.outcome === 'CAPTURED', ...out });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
