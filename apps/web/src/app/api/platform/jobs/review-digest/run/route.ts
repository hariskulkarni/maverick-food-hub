/**
 * POST /api/platform/jobs/review-digest/run
 *
 * Weekly Google review digest for restaurants that enabled it. Scheduled
 * Mondays 09:00 IST (deploy/flavrly-jobs.cron). Safe to retry: each restaurant
 * is claimed at most once per 6 days.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret matching INTERNAL_CRON_SECRET.
 */
import { NextRequest } from 'next/server';
import { runReviewDigest } from '@/server/jobs/review-digest';
import { jobAllowed } from '@/server/reviews/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await jobAllowed(req))) return new Response('Forbidden', { status: 403 });
  const result = await runReviewDigest();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}
