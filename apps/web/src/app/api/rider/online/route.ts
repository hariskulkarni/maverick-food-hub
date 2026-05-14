import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';

const Body = z.object({ online: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const { online } = Body.parse(await req.json());
  const p = await prisma.riderProfile.update({ where: { userId: session.user.id }, data: { isOnline: online } });
  return Response.json(p);
}
