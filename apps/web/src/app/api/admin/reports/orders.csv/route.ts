import { NextRequest } from 'next/server';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, reportRoute } from '@/server/reports/range';
import { ordersCsvStream } from '@/server/exports';
import { istDayKey } from '@/lib/ist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Raw order export — bounded by ?from&to (IST days, default last 30, max 366) and streamed. */
export const GET = reportRoute(async (req: NextRequest) => {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const { branchIds } = await requireAdminReportScope();
  const { from, to } = parseRange(new URL(req.url));
  return new Response(ordersCsvStream(branchIds, { from, to }), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${istDayKey()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
