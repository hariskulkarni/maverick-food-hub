/**
 * GET /api/platform/dispatch-insights?from=YYYY-MM-DD&to=YYYY-MM-DD[&restaurantId][&city][&format=csv]
 *
 * Dispatch KPIs over DELIVERY orders placed in an IST date range (≤ 92 days),
 * optionally filtered by restaurant / branch city. format=csv downloads the
 * per-day rows. Super admin only.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { parseOrJsonError } from '@/server/zod-helpers';
import { getDispatchInsights, defaultRange, csvRows, CSV_HEADERS } from '@/server/dispatch/insights';
import { getJitConfig } from '@/server/dispatch/settings';
import { csvResponse } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  restaurantId: z.string().min(1).max(64).optional(),
  city: z.string().trim().min(1).max(80).optional(),
  format: z.enum(['json', 'csv']).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
  const q = parseOrJsonError(Query, Object.fromEntries(req.nextUrl.searchParams));
  if (q instanceof Response) return q;
  const d = defaultRange();
  const filters = { from: q.from ?? d.from, to: q.to ?? d.to, restaurantId: q.restaurantId ?? null, city: q.city ?? null };
  try {
    const cfg = await getJitConfig();
    const data = await getDispatchInsights(filters, { slaMin: cfg.promiseSlaMin, includeZones: q.format !== 'csv' });
    if (q.format === 'csv') {
      return csvResponse({ headers: CSV_HEADERS, rows: csvRows(data.daily), filename: `dispatch-insights-${filters.from}-to-${filters.to}.csv` });
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
