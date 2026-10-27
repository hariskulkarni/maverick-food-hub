/**
 * POST /api/rider/assignments/[id]/call-customer
 *
 * Masked call: rings the rider's own phone and, once they pick up, bridges
 * them to the customer through the ExoPhone — neither side sees the other's
 * number. Auth: rider Bearer token (app) or rider portal cookie.
 *
 *   200 { ok, callId, message }           call placed (no numbers, ever)
 *   403 test_account                      test rider / test customer — no real calls
 *   404 not_found                         not this rider's assignment
 *   409 not_active                        assignment/order not in a callable state
 *   422 customer_phone_missing | rider_phone_missing
 *   429 rate_limited (+ Retry-After)      3 calls per assignment per 10 min
 *   502 call_failed                       provider refused / unreachable
 *   503 telephony_unavailable             Exotel not configured
 *
 * See src/server/telephony/masked-call.ts for the rules.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { clientIp } from '@/server/http/client-ip';
import { requestCustomerCall } from '@/server/telephony/masked-call';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const r = await requestCustomerCall({ userId: session.user.id, assignmentId: id, ipAddress: clientIp(req.headers) });
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if ('retryAfterSec' in r && r.retryAfterSec) headers['Retry-After'] = String(r.retryAfterSec);
  return Response.json(r.body, { status: r.status, headers });
}
