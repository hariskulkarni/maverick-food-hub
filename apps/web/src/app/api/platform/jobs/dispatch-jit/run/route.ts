/**
 * POST /api/platform/jobs/dispatch-jit/run — every minute.
 * Releases JIT-held orders into the existing rider dispatch flow. No-op while
 * the JIT platform setting is off. Idempotent (single-winner release).
 * Auth: x-internal-secret (constant-time) OR SUPER_ADMIN session.
 */
import { NextRequest } from 'next/server';
import { jobAllowed } from '@/server/reviews/cron-auth';
import { runJitReleaseSweep } from '@/server/dispatch/jit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!(await jobAllowed(req))) return Response.json({ error: 'Forbidden' }, { status: 403 });
  const result = await runJitReleaseSweep();
  return Response.json({ ok: true, ...result, at: new Date().toISOString() });
}

export const GET = POST;
