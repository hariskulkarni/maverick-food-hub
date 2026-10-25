import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { rejectManualAllocation } from '@/server/pg/reconcile-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().trim().min(1).max(1000) });

/** SUPER_ADMIN rejects (or the proposer withdraws) an undecided manual-allocation proposal. */
export async function POST(req: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { proposalId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'A reason is required.' }, { status: 400 });
  try {
    const out = await rejectManualAllocation({ proposalId, actorId: gate.user.id, reason: parsed.data.reason });
    await audit('pg.allocation.reject', {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'PgFinancialEvent',
      entityId: proposalId,
      after: { reason: parsed.data.reason },
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
