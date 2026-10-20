import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

const Body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) })
});

export async function POST(req: Request) {
  const s = await auth();
  if (!s?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  const userAgent = req.headers.get('user-agent') ?? undefined;
  const data = { userId: s.user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent };
  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, ...data },
    update: data
  });
  return Response.json({ ok: true });
}
