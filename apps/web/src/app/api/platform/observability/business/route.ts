/**
 * GET /api/platform/observability/business?range= — super-admin + 2FA.
 * Orders/min, payments by provider, stuck orders, refunds, reviews, support,
 * riders online / heartbeat freshness, SOS, pluggable provider health.
 */
import { NextRequest } from 'next/server';
import { requireObservabilityApi, parseRange } from '@/server/observability/access';
import { businessHealth } from '@/server/observability/q-business';
import { memo, NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const r = parseRange(req.nextUrl.searchParams.get('range'));
  const data = await memo(`business:${r.key}`, 15_000, () => businessHealth(r.since, r.minutes));
  return Response.json({ range: r.key, ...data }, { headers: NO_STORE });
}
