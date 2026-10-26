import { z } from 'zod';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { prisma } from '@/server/db';
import { pgServiceErrorResponse } from '@/server/pg/admin-access';
import { enterManualBankTransaction } from '@/server/pg/bank-ingest';
import { parseInrAmount } from '@/server/pg/bank-source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  receivingAccountId: z.string().min(1).max(64),
  direction: z.enum(['CREDIT', 'DEBIT']).default('CREDIT'),
  amount: z.string().trim().min(1).max(20),
  bankReference: z.string().trim().min(4).max(64),
  /** Local IST date-time from the bank statement, e.g. 2026-10-24T13:45 */
  valueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  narration: z.string().max(500).optional(),
});

/**
 * SUPER_ADMIN step 1 of dual-control manual bank entry. Stored PENDING_APPROVAL; a DIFFERENT
 * user must approve it (bank-entries/[id]/approve) before the engine can allocate it.
 */
export async function POST(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Account, amount, reference and value date/time are required.' }, { status: 400 });
  const b = parsed.data;
  let amountPaise: number | null;
  try {
    amountPaise = parseInrAmount(b.amount);
  } catch {
    amountPaise = null;
  }
  if (!amountPaise || amountPaise <= 0) return Response.json({ error: 'Enter the amount in rupees, e.g. 250.00' }, { status: 400 });
  const valueAt = new Date(`${b.valueAt}:00+05:30`);
  if (Number.isNaN(valueAt.getTime())) return Response.json({ error: 'Invalid value date/time' }, { status: 400 });
  const account = await prisma.pgReceivingAccount.findUnique({ where: { id: b.receivingAccountId }, select: { id: true, restaurantId: true } });
  if (!account) return Response.json({ error: 'No such receiving account' }, { status: 404 });
  try {
    const out = await enterManualBankTransaction({
      receivingAccountId: account.id,
      direction: b.direction,
      amountPaise,
      bankReference: b.bankReference,
      valueAt,
      narration: b.narration,
      enteredById: gate.user.id,
    });
    await audit('pg.bank_entry.enter', {
      actorId: gate.user.id,
      actorRole: gate.user.role,
      restaurantId: account.restaurantId,
      entityType: 'PgBankTransaction',
      entityId: out.id,
      after: { direction: b.direction, amountPaise, duplicate: out.duplicate },
    });
    return Response.json({ ok: true, ...out }, { status: out.duplicate ? 200 : 201 });
  } catch (e) {
    return pgServiceErrorResponse(e);
  }
}
