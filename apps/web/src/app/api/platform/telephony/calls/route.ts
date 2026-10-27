/**
 * GET /api/platform/telephony/calls?orderId=…|riderId=…
 * Super-admin view of masked-call history for one order or one rider.
 * Returns ids, statuses, durations and timings — never a phone number.
 */
import { NextRequest } from 'next/server';
import { requireSuperAdminApi } from '@/server/api-auth';
import { listCallLogs } from '@/server/telephony/masked-call';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ID = /^[a-z0-9]{10,40}$/i;

export async function GET(req: NextRequest) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const orderId = req.nextUrl.searchParams.get('orderId') ?? undefined;
  const riderId = req.nextUrl.searchParams.get('riderId') ?? undefined;
  if ((!orderId && !riderId) || (orderId && !ID.test(orderId)) || (riderId && !ID.test(riderId))) {
    return Response.json({ error: 'Pass a valid orderId or riderId.' }, { status: 400 });
  }
  const calls = await listCallLogs({ orderId, riderId });
  return Response.json({ calls }, { headers: { 'Cache-Control': 'no-store' } });
}
