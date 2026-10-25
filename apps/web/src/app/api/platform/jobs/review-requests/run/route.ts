/**
 * POST /api/platform/jobs/review-requests/run
 *
 * Sends due post-order Google review asks + reminders. Schedule every 5 minutes
 * (deploy/flavrly-jobs.cron). Idempotent: safe to run concurrently or retry.
 *
 * Auth: SUPER_ADMIN session OR x-internal-secret matching INTERNAL_CRON_SECRET
 * (constant-time compare).
 */
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { auth } from '@/server/auth';
import { runReviewRequestsSweep } from '@/server/jobs/review-requests-sweep';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function secretMatches(header: string | null): boolean {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  let allowed = secretMatches(req.headers.get('x-internal-secret'));
  if (!allowed) {
    const session = await auth();
    allowed = session?.user?.role === 'SUPER_ADMIN';
  }
  if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const result = await runReviewRequestsSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
