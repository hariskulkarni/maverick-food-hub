/**
 * POST /api/platform/jobs/zone-snapshot/run — every 5 minutes.
 * Writes the H3 res-8 open-orders vs riders snapshot (ZoneSupplyDemand).
 * Re-running within the same 5-min bucket replaces it.
 * Auth: x-internal-secret (constant-time) OR SUPER_ADMIN session.
 */
import { NextRequest } from 'next/server';
import { jobAllowed } from '@/server/reviews/cron-auth';
import { runZoneSnapshot } from '@/server/dispatch/zones';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await jobAllowed(req))) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = await runZoneSnapshot();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
