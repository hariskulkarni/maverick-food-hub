import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { shiftGateBlockers } from '@/server/training/service';

const Body = z.object({ online: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const { online } = Body.parse(await req.json());
  if (online) {
    // Training gate (platform setting, default off): required shift-blocking
    // safety modules must be passed before going online. Going OFFLINE is never blocked.
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, createdAt: true } });
    const blockers = user ? await shiftGateBlockers(user) : [];
    if (blockers.length > 0) {
      return Response.json(
        {
          error: `Finish your required safety training before going online: ${blockers.map((b) => b.title).join(', ')}.`,
          code: 'training/required',
          modules: blockers.map((b) => ({ id: b.moduleId, title: b.title })),
        },
        { status: 409 },
      );
    }
  }
  const p = await prisma.riderProfile.update({ where: { userId: session.user.id }, data: { isOnline: online } });
  return Response.json(p);
}
