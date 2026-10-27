/**
 * GET /api/platform/riders/[id]/insights/path
 *   ?assignmentId=…        → one delivery's reconstructed path (+ stored summary refresh)
 *   ?from=ISO&to=ISO       → shift path between two instants (≤ 24 h)
 *
 * Auth: riders:read.
 */
import { NextRequest } from 'next/server';
import { requireCapabilityApi } from '@/server/api-auth';
import { getDeliveryPath, getShiftPath, SHIFT_PATH_MAX_MS } from '@/server/rider-insights/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapabilityApi('riders:read');
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const sp = req.nextUrl.searchParams;

  const assignmentId = sp.get('assignmentId');
  if (assignmentId) {
    const path = await getDeliveryPath(id, assignmentId.slice(0, 64));
    if (!path) return Response.json({ error: 'Delivery not found for this rider' }, { status: 404 });
    return Response.json(path, { headers: { 'Cache-Control': 'no-store' } });
  }

  const from = new Date(sp.get('from') ?? '');
  const to = new Date(sp.get('to') ?? '');
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
    return Response.json({ error: 'Pass assignmentId, or valid from/to ISO timestamps (from < to)' }, { status: 400 });
  }
  if (to.getTime() - from.getTime() > SHIFT_PATH_MAX_MS) {
    return Response.json({ error: 'A shift path covers at most 24 hours' }, { status: 400 });
  }
  return Response.json(await getShiftPath(id, from, to), { headers: { 'Cache-Control': 'no-store' } });
}
