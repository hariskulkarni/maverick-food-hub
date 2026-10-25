/**
 * POST /api/platform/jobs/prep-stats/run — nightly (03:10 IST).
 * Recomputes per-restaurant × IST-hour prep-time P50/P60/P90 (last 28 days).
 * Auth: x-internal-secret (constant-time) OR SUPER_ADMIN session.
 */
import { NextRequest } from 'next/server';
import { jobAllowed } from '@/server/reviews/cron-auth';
import { computePrepStats } from '@/server/dispatch/prep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await jobAllowed(req))) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = await computePrepStats();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
