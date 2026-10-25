import { NextRequest } from 'next/server';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireAdminReportScope } from '@/server/reports/admin-branch';
import { parseRange, reportRoute } from '@/server/reports/range';
import { ordersToXlsx, ExportTooLargeError } from '@/server/exports';
import { istDayKey } from '@/lib/ist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Raw order export as XLSX — bounded by ?from&to (IST days, default last 30) and a row cap. */
export const GET = reportRoute(async (req: NextRequest) => {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const { branchIds } = await requireAdminReportScope();
  const { from, to } = parseRange(new URL(req.url));
  let buf: Buffer;
  try {
    buf = await ordersToXlsx(branchIds, { from, to });
  } catch (e) {
    if (e instanceof ExportTooLargeError) return Response.json({ error: e.message, reason: 'too_large' }, { status: 413 });
    throw e;
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="orders-${istDayKey()}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
});
