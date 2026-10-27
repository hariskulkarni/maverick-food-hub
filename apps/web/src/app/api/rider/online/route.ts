import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';
import { shiftGateBlockers } from '@/server/training/service';
import { riderKycGate } from '@/server/rider-kyc-gate';
import { recordStatusEvents } from '@/server/rider-insights/status-events';
import { getIntegrityConfig } from '@/server/rider-integrity/config';
import { resetShiftCounters } from '@/server/rider-integrity/service';

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
    // Device-integrity gate (platform setting gateOnlineOnFailed, DEFAULT OFF):
    // only when turned on does a FAILED Play Integrity verdict block going
    // online. Going OFFLINE is never blocked. Degrades cleanly — when Play
    // Integrity isn't configured the verdict is UNEVALUATED and nothing blocks.
    const integrityCfg = await getIntegrityConfig();
    if (integrityCfg.gateOnlineOnFailed) {
      const st = await prisma.riderIntegrityState.findUnique({
        where: { riderId: rp.id },
        select: { verdict: true },
      });
      if (st?.verdict === 'FAILED') {
        return Response.json(
          {
            error: 'integrity_failed',
            message:
              'Your device failed a security check. Please use the official Flavrly app on a standard, un-rooted device, or contact support.',
            code: 'integrity/failed',
          },
          { status: 409 },
        );
      }
    }
  }
  const before = await prisma.riderProfile.findUnique({ where: { userId: session.user.id }, select: { isOnline: true } });
  const p = await prisma.riderProfile.update({ where: { userId: session.user.id }, data: { isOnline: online } });
  // Rider insights: one ONLINE/OFFLINE event per real transition (re-asserting
  // the current state records nothing).
  if (before && before.isOnline !== online) {
    await recordStatusEvents([{ riderId: p.id, type: online ? 'ONLINE' : 'OFFLINE', source: 'rider' }]);
  }
  if (online) {
    // Going online is proof the app is alive right now: stamp lastSeenAt so the
    // auto-offline sweep (1-minute cron, 2-minute window) can't flip the rider
    // back offline before the app's first heartbeat / location ping lands.
    const now = new Date();
    await prisma.riderHeartbeat.upsert({
      where: { riderId: p.id },
      create: { riderId: p.id, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
    // Location-integrity: the mock-ping / spoof-score tallies are per shift, so
    // a new shift starts from zero. Review history + device verdict persist.
    await resetShiftCounters(p.id, now);
  }
  return Response.json(p);
}
