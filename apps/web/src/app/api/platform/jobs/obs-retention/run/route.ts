/**
 * POST /api/platform/jobs/obs-retention/run — daily (deploy/flavrly-jobs.cron).
 * Prunes every observability table to its retention window and snapshots table sizes.
 *
 * Auth: x-internal-secret (constant-time) OR a super-admin 2FA session.
 */
import { NextRequest } from 'next/server';
import { cronSecretMatches, jsonError } from '@/server/observability/route-helpers';
import { requireObservabilityApi } from '@/server/observability/access';
import { runRetention } from '@/server/observability/retention';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!cronSecretMatches(req.headers.get('x-internal-secret'))) {
    const gate = await requireObservabilityApi();
    if (gate instanceof Response) return jsonError(403, 'Forbidden');
  }
  const result = await runRetention();
  return Response.json({ ok: true, ...result });
}
