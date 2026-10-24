import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { changeReceivingAccountStatus, verifyReceivingAccount } from '@/server/pg/receiving-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('VERIFY'), method: z.string().max(100), note: z.string().max(1000) }),
  z.object({ action: z.enum(['SUSPEND', 'DISABLE_NEW', 'ENABLE_NEW', 'REVOKE']), reason: z.string().max(1000) }),
]);

/**
 * SUPER_ADMIN state change on a receiving account. VERIFY needs a method + note and a verifier
 * other than the creator. All actions are audited by the service.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid action.' }, { status: 400 });
  const actor = { id: gate.user.id, role: gate.user.role };
  try {
    const b = parsed.data;
    const a =
      b.action === 'VERIFY'
        ? await verifyReceivingAccount(id, { method: b.method, note: b.note }, actor)
        : await changeReceivingAccountStatus(id, b.action, b.reason, actor);
    return Response.json({ ok: true, id: a.id, status: a.status, disabledForNewAt: a.disabledForNewAt });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
