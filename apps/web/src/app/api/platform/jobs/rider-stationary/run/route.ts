/**
 * POST /api/platform/jobs/rider-stationary/run — every 2 minutes.
 * Opens a RIDER_STATIONARY escalation (live-ops) for on-task riders parked
 * away from pickup/drop. Debounced per assignment.
 * Auth: x-internal-secret (constant-time) OR SUPER_ADMIN session.
 */
import { NextRequest } from 'next/server';
import { jobAllowed } from '@/server/reviews/cron-auth';
import { runStationarySweep } from '@/server/dispatch/stationary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await jobAllowed(req))) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = await runStationarySweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
