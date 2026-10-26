/**
 * GET /api/platform/observability/notifications?range= — super-admin + 2FA.
 * Delivery by channel / provider / template, failure reasons, mock-in-production.
 */
import { NextRequest } from 'next/server';
import { requireObservabilityApi, parseRange } from '@/server/observability/access';
import { notificationsSnapshot } from '@/server/observability/q-ops';
import { memo, NO_STORE } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const r = parseRange(req.nextUrl.searchParams.get('range'));
  const data = await memo(`notifications:${r.key}`, 15_000, () => notificationsSnapshot(r.since));
  return Response.json({ range: r.key, ...data }, { headers: NO_STORE });
}
