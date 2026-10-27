/**
 * POST /api/platform/jobs/safety-alerts/run — every 2 minutes.
 * Raises/auto-resolves rider safety & anomaly escalations (route deviation,
 * ETA breach, long wait at restaurant, prolonged signal loss) on
 * /platform/live-ops. Operational location/status data only. Debounced per
 * assignment; each type toggleable via platform safety-alert settings.
 * Auth: x-internal-secret (constant-time) OR SUPER_ADMIN session.
 */
import { NextRequest } from 'next/server';
import { jobAllowed } from '@/server/reviews/cron-auth';
import { runSafetyAlertsSweep } from '@/server/safety/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await jobAllowed(req))) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = await runSafetyAlertsSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
