/**
 * POST /api/platform/jobs/rider-trip-summaries/run — every 10 min
 * (deploy/flavrly-jobs.cron). Reconstructs the GPS path of recently delivered
 * assignments and stores a RiderTripSummary (distance, duration, max gap).
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret header matching env.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/auth';
import { secretMatches } from '@/server/http/secret-compare';
import { runTripSummaries } from '@/server/rider-insights/trips';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const allowed =
    secretMatches(req.headers.get('x-internal-secret'), process.env.INTERNAL_CRON_SECRET) ||
    (await auth())?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });
  const result = await runTripSummaries();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}
