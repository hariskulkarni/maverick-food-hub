/**
 * GET /api/platform/observability/api?range=&kind=API|PAGE&route=&method= — super-admin + 2FA.
 * Golden signals per route (count, 4xx/5xx, P50/P95/P99) + time series
 * (overall, or for one route when `route` is given — the drill-down).
 */
import { NextRequest } from 'next/server';
import { requireObservabilityApi, parseRange } from '@/server/observability/access';
import { routeStats, series } from '@/server/observability/q-api';
import { memo, NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const sp = req.nextUrl.searchParams;
  const r = parseRange(sp.get('range'));
  const kind = sp.get('kind') === 'PAGE' ? 'PAGE' : 'API';
  const route = sp.get('route')?.slice(0, 200) || null;
  const method = sp.get('method')?.toUpperCase().slice(0, 10) || null;
  const data = await memo(`api:${r.key}:${kind}:${route}:${method}`, 10_000, async () => {
    const [routes, s] = await Promise.all([
      route ? Promise.resolve(null) : routeStats(r.since, r.minutes, { kind }),
      series(r.since, r.minutes, { route, method, kind: route ? undefined : kind }),
    ]);
    return { routes, series: s };
  });
  return Response.json({ range: r.key, kind, route, method, ...data }, { headers: NO_STORE });
}
