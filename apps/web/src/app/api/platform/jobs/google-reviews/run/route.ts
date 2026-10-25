/**
 * POST /api/platform/jobs/google-reviews/run
 *
 * Syncs Google reviews for connected restaurants, applies the auto-reply rules,
 * sends negative-review alerts, recomputes insights and escalates overdue
 * replies. Scheduled every 15 minutes (deploy/flavrly-jobs.cron):
 *
 *   every 15 minutes: curl -fsS -X POST https://<domain>/api/platform/jobs/google-reviews/run \
 *                  -H "x-internal-secret: $INTERNAL_CRON_SECRET"
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret matching INTERNAL_CRON_SECRET.
 */
import { NextRequest } from 'next/server';
import { runGoogleReviewsSweep } from '@/server/jobs/google-reviews-sweep';
import { jobAllowed } from '@/server/reviews/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await jobAllowed(req))) return new Response('Forbidden', { status: 403 });
  const result = await runGoogleReviewsSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
