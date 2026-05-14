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

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel');
  if (!channel) return new Response('Missing channel', { status: 400 });
  const since = req.nextUrl.searchParams.get('since');

  const events = getBufferedSince(channel, since);
  return Response.json({ now: new Date().toISOString(), events });
}
