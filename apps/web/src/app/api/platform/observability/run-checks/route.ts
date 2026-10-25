/**
 * POST /api/platform/observability/run-checks — super-admin.
 * Runs the full probe suite on demand (the dashboard's "Run checks now" button),
 * so the operator doesn't have to wait for the 60s background cycle.
 */
import { requireSuperAdminApi } from '@/server/api-auth';
import { runAllProbes } from '@/server/observability/probes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  await runAllProbes();
  return Response.json({ ok: true, ranAt: new Date().toISOString() });
}
