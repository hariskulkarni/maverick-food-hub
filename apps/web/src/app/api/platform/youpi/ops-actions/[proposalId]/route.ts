import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { decideOpsAction } from '@/server/pg/ops-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(1000).optional() });

/** SUPER_ADMIN step 2: a DIFFERENT user approves (the action runs in the same transaction), or anyone rejects. */
export async function POST(req: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { proposalId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'A decision (APPROVE or REJECT) is required.' }, { status: 400 });
  try {
    const out = await decideOpsAction({ proposalId, actorId: gate.user.id, decision: parsed.data.decision, note: parsed.data.note });
    await audit(`pg.${out.action.toLowerCase()}.${out.decision.toLowerCase()}`, {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'PgFinancialEvent',
      entityId: proposalId,
      after: { ...out },
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
