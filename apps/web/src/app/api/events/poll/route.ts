/**
 * Polling fallback for the SSE bus. Returns any RealtimeEvents emitted to the
 * given channel since the supplied ISO `since` timestamp. Backed by the
 * in-memory ring buffer in @/server/realtime (cap 100 per channel).
 *
 * Response: { now: string; events: { seq: number; at: string; event: ... }[] }
 *
 * Clients should pass `now` back as `since` on the next poll.
 */
import { NextRequest } from 'next/server';
import { getBufferedSince } from '@/server/realtime';
import { auth } from '@/server/rider-auth';
import { authorizeRealtimeChannel } from '@/server/realtime-authz';

export const dynamic = 'force-dynamic';
// Node runtime: the authz path uses Prisma + the EventEmitter ring buffer.
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel');
  if (!channel) return new Response('Missing channel', { status: 400 });
  const since = req.nextUrl.searchParams.get('since');

  // Same authorization gate as the SSE endpoint — the polling fallback must not
  // be a backdoor around channel authorization.
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  if (!(await authorizeRealtimeChannel(session.user, channel))) {
    return new Response('Forbidden', { status: 403 });
  }

  const events = getBufferedSince(channel, since);
  return Response.json({ now: new Date().toISOString(), events });
}
