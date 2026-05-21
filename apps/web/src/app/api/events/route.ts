import { NextRequest } from 'next/server';
import { bus } from '@/server/realtime';
import { auth } from '@/server/rider-auth';
import { authorizeRealtimeChannel } from '@/server/realtime-authz';

export const dynamic = 'force-dynamic';
// Edge would be faster, but we need Node's EventEmitter bus.
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel');
  if (!channel) return new Response('Missing channel', { status: 400 });

  // Authorize the subscription. `auth()` here is the rider-aware variant: it
  // accepts a rider Bearer token (native app) and falls back to the NextAuth
  // cookie session (web). Unauthenticated or unauthorized → 401/403, never a
  // silent subscription to someone else's order/branch/rider stream.
  const session = await auth();
  if (!session?.user) return new Response('Unauthorized', { status: 401 });
  if (!(await authorizeRealtimeChannel(session.user, channel))) {
    return new Response('Forbidden', { status: 403 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller closed mid-send (client disconnected). Swallow.
        }
      };
      const handler = (evt: unknown) => send(evt);
      bus.on(channel, handler);

      // 2KB of leading whitespace forces every buffering proxy on the way
      // (nginx without proxy_buffering off, Cloudflare without grey-cloud, any
      // intermediate CDN) to flush the response head and start streaming.
      // Without this the EventSource never fires `onopen` until the first real
      // event arrives, which from the client's perspective looks identical to
      // a failed connection.
      const padding = ':' + ' '.repeat(2048) + '\n\n';
      controller.enqueue(enc.encode(padding));
      controller.enqueue(enc.encode(`: connected ${channel}\n\n`));
      // Heartbeat every 15s — short enough to keep nginx (default 60s read
      // timeout) and Cloudflare (~100s idle) from killing the connection,
      // long enough that the per-connection overhead is negligible.
      const hb = setInterval(() => {
        try { controller.enqueue(enc.encode(`: hb\n\n`)); } catch { /* closed */ }
      }, 15_000);

      const onAbort = () => {
        bus.off(channel, handler);
        clearInterval(hb);
        try { controller.close(); } catch {}
      };
      req.signal.addEventListener('abort', onAbort);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // `no-transform` blocks gzip/brotli mid-flight, which would otherwise
      // buffer until the compression window fills.
      'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
      // `X-Accel-Buffering: no` is the explicit nginx flush hint, in case the
      // operator hasn't applied the per-location proxy_buffering off rule.
      // Cloudflare also honours it.
      'X-Accel-Buffering': 'no',
      // `identity` defeats any upstream that auto-negotiates gzip on
      // text/event-stream (some PaaS frontends do).
      'Content-Encoding': 'identity',
      Connection: 'keep-alive',
      // CORS — same-origin in production but easier debugging when probed.
      'Access-Control-Allow-Origin': '*'
    }
  });
}
