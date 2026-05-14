import { NextRequest } from 'next/server';
import { bus } from '@/server/realtime';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const channel = req.nextUrl.searchParams.get('channel');
  if (!channel) return new Response('Missing channel', { status: 400 });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      const handler = (evt: unknown) => send(evt);
      bus.on(channel, handler);

      // initial comment to open the stream + heartbeat every 25s
      controller.enqueue(enc.encode(`: connected ${channel}\n\n`));
      const hb = setInterval(() => controller.enqueue(enc.encode(`: hb\n\n`)), 25_000);

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
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
