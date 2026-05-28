/**
 * Training module — single-row mutations (super-admin only).
 *   PATCH  — update any subset of fields (incl. toggle isActive / isRequired).
 *   DELETE — hard-delete the module (cascades RiderTrainingProgress).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { serializeModule } from '../_serializers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES = ['ONBOARDING', 'SAFETY', 'CUSTOMER_SERVICE', 'EARNINGS', 'APP_GUIDE'] as const;

const PatchBody = z.object({
  title: z.string().min(2).max(160).optional(),
  summary: z.string().max(500).nullable().optional(),
  category: z.enum(CATEGORIES).optional(),
  contentBody: z.string().min(1).optional(),
  contentBlocks: z.array(z.any()).optional(),
  heroImageUrl: z.string().max(2048).nullable().optional(),
  quizQuestions: z.any().optional(),
  durationMin: z.number().int().min(1).max(600).optional(),
  order: z.number().int().min(0).max(9999).optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());

  const before = await prisma.trainingModule.findUnique({ where: { id } });
  if (!before) return new Response('Training module not found', { status: 404 });

  const patch: any = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.summary !== undefined) patch.summary = data.summary;
  if (data.category !== undefined) patch.category = data.category;
  if (data.contentBody !== undefined) patch.contentBody = data.contentBody;
  if (data.contentBlocks !== undefined) {
    const { parseContentBlocks } = await import('@/server/training-cms');
    patch.contentBlocks = parseContentBlocks(data.contentBlocks);
    patch.contentVersion = 2;
  }
  if (data.heroImageUrl !== undefined) patch.heroImageUrl = data.heroImageUrl ?? null;
  if (data.quizQuestions !== undefined) patch.quizQuestions = data.quizQuestions ?? undefined;
  if (data.durationMin !== undefined) patch.durationMin = data.durationMin;
  if (data.order !== undefined) patch.order = data.order;
  if (data.isRequired !== undefined) patch.isRequired = data.isRequired;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const after = await prisma.trainingModule.update({ where: { id }, data: patch });

  await audit('training.module.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'TrainingModule',
    entityId: id,
    before: serializeModule(before),
    after: serializeModule(after),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ module: serializeModule(after) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;

  const before = await prisma.trainingModule.findUnique({ where: { id } });
  if (!before) return new Response('Training module not found', { status: 404 });

  await prisma.trainingModule.delete({ where: { id } });

  await audit('training.module.delete', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'TrainingModule',
    entityId: id,
    before: serializeModule(before),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ ok: true });
}
