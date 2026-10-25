/**
 * POST /api/platform/training-modules/[id]/reset-attempts  { userId }
 * Super-admin: clear a learner's quiz attempts for the module's CURRENT
 * version (unlocks someone who used up `maxAttempts`). Certificates untouched.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ userId: z.string().min(1).max(64) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const data = parseOrJsonError(Body, await req.json().catch(() => null));
  if (data instanceof Response) return data;
  const mod = await prisma.trainingModule.findUnique({ where: { id }, select: { id: true, version: true } });
  if (!mod) return Response.json({ error: 'Training module not found' }, { status: 404 });
  const { count } = await prisma.trainingQuizAttempt.deleteMany({
    where: { moduleId: id, userId: data.userId, moduleVersion: mod.version, passed: false },
  });
  await audit('training.attempts.reset', {
    actorId: gate.user.id,
    actorRole: gate.user.role,
    entityType: 'TrainingModule',
    entityId: id,
    after: { userId: data.userId, moduleVersion: mod.version, removed: count },
  });
  return Response.json({ ok: true, removed: count });
}
