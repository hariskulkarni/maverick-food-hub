/**
 * POST /api/rider/push-token
 *
 * The native rider app registers its Expo push token here, on launch and after
 * login. Stored on RiderProfile.expoPushToken; the order-ready hook reads it to
 * ping online riders about new pool orders.
 *
 * Body: { token: string }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ token: z.string().min(1).max(256) });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'token is required' }, { status: 400 });
  const { token } = parsed.data;
  // P2-20: a device token belongs to exactly one rider — when a phone changes
  // hands (or a rider re-logs on a shared device) detach it from every other
  // profile so pings never reach the previous rider.
  await prisma.$transaction([
    prisma.riderProfile.updateMany({
      where: { expoPushToken: token, NOT: { userId: session.user.id } },
      data: { expoPushToken: null },
    }),
    prisma.riderProfile.update({
      where: { userId: session.user.id },
      data: { expoPushToken: token },
    }),
  ]);
  return Response.json({ ok: true });
}
