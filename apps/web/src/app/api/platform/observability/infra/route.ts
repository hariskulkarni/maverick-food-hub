/**
 * GET /api/platform/observability/infra — super-admin + 2FA.
 * Postgres internals, app process, Redis/cache, disk, probes, dependencies.
 */
import { requireObservabilityApi } from '@/server/observability/access';
import { infraSnapshot } from '@/server/observability/q-infra';
import { memo, NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const data = await memo('infra', 10_000, () => infraSnapshot());
  return Response.json(data, { headers: NO_STORE });
}
