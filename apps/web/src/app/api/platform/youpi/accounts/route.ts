import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { createReceivingAccount } from '@/server/pg/receiving-accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  restaurantId: z.string().min(1).max(64),
  gatewayMerchantId: z.string().max(128),
  vpa: z.string().max(130),
  legalEntityName: z.string().max(200),
  ifsc: z.string().max(20),
  accountNumber: z.string().max(40),
});

/** SUPER_ADMIN: register a receiving account (PENDING_VERIFICATION). Raw account number is not stored. */
export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'All fields are required.' }, { status: 400 });
  try {
    const a = await createReceivingAccount(parsed.data, { id: gate.user.id, role: gate.user.role });
    return Response.json({ ok: true, id: a.id, status: a.status }, { status: 201 });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
