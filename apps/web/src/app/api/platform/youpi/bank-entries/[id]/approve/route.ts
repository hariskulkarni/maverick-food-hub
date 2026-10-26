import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { approveManualBankTransaction } from '@/server/pg/bank-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SUPER_ADMIN step 2: a DIFFERENT user approves a manual bank entry (enforced in bank-ingest). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id } = await params;
  try {
    const out = await approveManualBankTransaction(id, gate.user.id);
    await audit('pg.bank_entry.approve', {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      entityType: 'PgBankTransaction',
      entityId: id,
      after: { status: out.status },
    });
    return Response.json({ ok: true, ...out });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
