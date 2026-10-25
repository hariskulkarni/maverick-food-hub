/**
 * GET /api/platform/observability/jobs?range= — super-admin + 2FA.
 * Every scheduled job: schedule (from the cron file), last run, success rate,
 * overdue/failing state, recent runs; plus the DB job-queue depth.
 */
import { NextRequest } from 'next/server';
import { requireObservabilityApi, parseRange } from '@/server/observability/access';
import { jobsSnapshot } from '@/server/observability/q-ops';
import { memo, NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const r = parseRange(req.nextUrl.searchParams.get('range'));
  const data = await memo(`jobs:${r.key}`, 10_000, () => jobsSnapshot(r.since));
  return Response.json({ range: r.key, ...data }, { headers: NO_STORE });
}
