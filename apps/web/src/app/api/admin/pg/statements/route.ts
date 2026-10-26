import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requirePgRestaurantAdmin } from '@/server/pg/admin-access';
import { importStatementCsv } from '@/server/pg/bank-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 2 MB of CSV text is far above a month of statement lines for one pilot account. */
const MAX_CSV_CHARS = 2_000_000;

const Header = z.string().trim().min(1).max(80);
const Body = z.object({
  receivingAccountId: z.string().min(1).max(64),
  fileName: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(MAX_CSV_CHARS),
  mapping: z.object({
    date: Header,
    valueDate: Header.optional(),
    narration: Header.optional(),
    reference: Header,
    credit: Header,
    debit: Header.optional(),
    dateFormat: z.enum(['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'DD MMM YYYY']),
  }),
});

/**
 * Restaurant ADMIN uploads a bank statement CSV for one of ITS receiving accounts.
 * Calls bank-ingest (file-level and row-level dedupe, redaction, auto-allocation).
 */
export async function POST(req: Request) {
  const gate = await requirePgRestaurantAdmin();
  if (gate instanceof Response) return gate;
  const { session, restaurant } = gate;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Choose a receiving account, a CSV file (max 2 MB) and map the columns.' }, { status: 400 });
  }
  const input = parsed.data;
  // Tenant scope: the account must belong to the caller's active restaurant.
  const account = await prisma.pgReceivingAccount.findFirst({
    where: { id: input.receivingAccountId, restaurantId: restaurant.id },
    select: { id: true },
  });
  if (!account) return Response.json({ error: 'No such receiving account' }, { status: 404 });

  const out = await importStatementCsv({
    receivingAccountId: account.id,
    fileName: input.fileName,
    content: input.content,
    mapping: input.mapping,
    uploadedById: session.user.id,
  });
  await audit('pg.statement.import', {
    actorId: session.user.id,
    actorRole: session.user.role,
    restaurantId: restaurant.id,
    entityType: 'PgStatementImport',
    entityId: out.importId,
    after: {
      receivingAccountId: account.id,
      fileName: input.fileName,
      duplicateFile: out.duplicateFile,
      insertedCount: out.insertedCount,
      duplicateCount: out.duplicateCount,
      conflictCount: out.conflictCount,
      rejectedCount: out.rejected.length,
    },
  });
  return Response.json({ ...out, rejected: out.rejected.slice(0, 200), rejectedCount: out.rejected.length });
}
