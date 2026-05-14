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

  const { token } = Body.parse(await req.json());
  await prisma.riderProfile.update({
    where: { userId: session.user.id },
    data: { expoPushToken: token },
  });
  return Response.json({ ok: true });
}
