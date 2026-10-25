import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { shiftGateBlockers } from '@/server/training/service';
import { riderKycGate } from '@/server/rider-kyc-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ online: z.boolean() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });
  const parsedBody = Body.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) return Response.json({ error: 'online must be true or false' }, { status: 400 });
  const { online } = parsedBody.data;
  if (online) {
    // KYC gate (platform setting riderKycGate, default ON): every required
    // document approved and in date (+grace). Going OFFLINE is never blocked.
    const rp = await prisma.riderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
    if (!rp) return new Response('No rider profile', { status: 404 });
    const kyc = await riderKycGate(rp.id);
    if (!kyc.canGoOnline) {
      return Response.json(
        { error: 'kyc_incomplete', message: kyc.message, code: 'kyc/incomplete', blockingTypes: kyc.blockingTypes },
        { status: 409 },
      );
    }
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
