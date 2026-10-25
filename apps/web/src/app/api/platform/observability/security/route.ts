/**
 * GET /api/platform/observability/security?range= — super-admin + 2FA.
 * Failed logins / lockouts, 2FA, password resets, super-admin actions,
 * 403s by route + role, rate-limit hits, webhook rejections.
 */
import { NextRequest } from 'next/server';
import { requireObservabilityApi, parseRange } from '@/server/observability/access';
import { securitySnapshot } from '@/server/observability/q-ops';
import { memo, NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const r = parseRange(req.nextUrl.searchParams.get('range'));
  const data = await memo(`security:${r.key}`, 15_000, () => securitySnapshot(r.since));
  return Response.json({ range: r.key, ...data }, { headers: NO_STORE });
}
