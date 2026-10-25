/**
 * GET /api/platform/observability/overview?range=15m|1h|24h|7d — super-admin + 2FA.
 * Health score, active alerts, headline KPIs and the API traffic series.
 */
import { NextRequest } from 'next/server';
import { requireObservabilityApi, parseRange } from '@/server/observability/access';
import { overviewSnapshot } from '@/server/observability/overview';
import { memo, NO_STORE } from '@/server/observability/route-helpers';
import { startObservabilityRunner } from '@/server/observability/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  // Keep the dependency probes running while someone is watching (idempotent).
  startObservabilityRunner();
  const r = parseRange(req.nextUrl.searchParams.get('range'));
  const data = await memo(`overview:${r.key}`, 10_000, () => overviewSnapshot(r.since, r.minutes));
  return Response.json({ range: r.key, ...data }, { headers: NO_STORE });
}
