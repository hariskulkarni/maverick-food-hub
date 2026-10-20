import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

const Body = z.object({ endpoint: z.string().min(1) });

export async function POST(req: Request) {
  const s = await auth();
  if (!s?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 });
  await prisma.webPushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint, userId: s.user.id } });
  return Response.json({ ok: true });
}
