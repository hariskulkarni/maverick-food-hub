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
import { auth } from '@/server/auth';
import { secretMatches } from '@/server/http/secret-compare';
import { runGoogleReviewsSweep } from '@/server/jobs/google-reviews-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const internalSecret = process.env.INTERNAL_CRON_SECRET;
  const headerSecret = req.headers.get('x-internal-secret');
  const session = await auth();
  const allowed =
    secretMatches(headerSecret, internalSecret) ||
    session?.user?.role === 'SUPER_ADMIN';
  if (!allowed) return new Response('Forbidden', { status: 403 });

  const result = await runGoogleReviewsSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}
