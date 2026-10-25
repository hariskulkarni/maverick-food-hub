/**
 * Training module — single row.
 *   GET    (cms:read)    — full editor payload (lessons, questions, translations).
 *   PATCH  (super-admin) — update settings and/or replace the ordered lesson +
 *                          question set; `bumpVersion: true` starts a new
 *                          version so every learner must re-certify.
 *   DELETE (super-admin) — hard-delete (cascades lessons, progress, certificates).
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireCapabilityApi, requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';
import { applyModuleContent, loadModuleForEditor, ModuleContentSchema } from '@/server/training/authoring';
import { serializeModule } from '../_serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const withCounts = { _count: { select: { lessons: true, questions: true } } } as const;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapabilityApi('cms:read');
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const mod = await loadModuleForEditor(prisma, id);
  if (!mod) return Response.json({ error: 'Training module not found' }, { status: 404 });
  return Response.json({ module: mod });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const { id } = await params;
  const data = parseOrJsonError(ModuleContentSchema, await req.json().catch(() => null));
  if (data instanceof Response) return data;

  const before = await prisma.trainingModule.findUnique({ where: { id }, include: withCounts });
  if (!before) return Response.json({ error: 'Training module not found' }, { status: 404 });

  if (data.isActive === true) {
    const lessons = data.lessons?.length ?? before._count.lessons;
    const hasLegacy = !!before.contentBody?.trim() || Array.isArray(before.contentBlocks);
    if (lessons === 0 && !hasLegacy) {
      return Response.json({ error: 'Add at least one lesson before publishing.' }, { status: 400 });
    }
  }

  await prisma.$transaction((tx) => applyModuleContent(tx, id, data), { timeout: 20_000 });
  const after = await prisma.trainingModule.findUniqueOrThrow({ where: { id }, include: withCounts });

  await audit(data.bumpVersion ? 'training.module.version_bump' : 'training.module.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'TrainingModule',
    entityId: id,
    before: serializeModule(before),
    after: serializeModule(after),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ module: serializeModule(after), editor: await loadModuleForEditor(prisma, id) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const { id } = await params;

  const before = await prisma.trainingModule.findUnique({ where: { id }, include: withCounts });
  if (!before) return Response.json({ error: 'Training module not found' }, { status: 404 });

  await prisma.trainingModule.delete({ where: { id } });

  await audit('training.module.delete', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'TrainingModule',
    entityId: id,
    before: serializeModule(before),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ ok: true });
}
