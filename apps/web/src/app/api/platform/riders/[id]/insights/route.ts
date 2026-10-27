/**
 * GET /api/platform/riders/[id]/insights — rider operational insights:
 * current status, last location, device/network/battery, online/offline
 * timeline, today + 7-day stats and recent deliveries.
 *
 * Auth: riders:read (SUPER_ADMIN, and delegated platform roles holding it).
 */
import { NextRequest } from 'next/server';
import { requireCapabilityApi } from '@/server/api-auth';
import { getRiderInsights } from '@/server/rider-insights/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapabilityApi('riders:read');
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const data = await getRiderInsights(id);
  if (!data) return Response.json({ error: 'Rider not found' }, { status: 404 });
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
