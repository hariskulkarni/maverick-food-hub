import { requirePgRestaurantAdmin } from '@/server/pg/admin-access';
import { buildPgReconciliationReport, pgReconciliationCsv } from '@/server/pg/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 93;

/** Restaurant ADMIN: CSV export of this restaurant's Flavrly PG reconciliation (pg/reports.ts). */
export async function GET(req: Request) {
  const gate = await requirePgRestaurantAdmin();
  if (gate instanceof Response) return gate;
  const url = new URL(req.url);
  const fromS = url.searchParams.get('from') ?? '';
  const toS = url.searchParams.get('to') ?? '';
  if (!DAY.test(fromS) || !DAY.test(toS)) return Response.json({ error: 'from and to must be YYYY-MM-DD' }, { status: 400 });
  // Whole IST days.
  const from = new Date(`${fromS}T00:00:00+05:30`);
  const to = new Date(`${toS}T23:59:59.999+05:30`);
  if (Number.isNaN(+from) || Number.isNaN(+to) || from > to || +to - +from > MAX_DAYS * 86_400_000) {
    return Response.json({ error: `Choose a period of at most ${MAX_DAYS} days.` }, { status: 400 });
  }
  const report = await buildPgReconciliationReport({ restaurantId: gate.restaurant.id, from, to });
  return new Response(pgReconciliationCsv(report), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="flavrly-pg-${fromS}-to-${toS}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
