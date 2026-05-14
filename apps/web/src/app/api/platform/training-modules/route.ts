/**
 * Training modules — super-admin CRUD list endpoint.
 *   GET  — list all modules (by `order`, then newest) with completion stats:
 *          how many RiderTrainingProgress rows are `completed` per module.
 *   POST — create a module.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CATEGORIES = ['ONBOARDING', 'SAFETY', 'CUSTOMER_SERVICE', 'EARNINGS', 'APP_GUIDE'] as const;

export function serializeModule(m: any, stats?: { completed: number; total: number }) {
  return {
    id: m.id,
    title: m.title,
    summary: m.summary ?? null,
    category: m.category,
    contentBody: m.contentBody,
    quizQuestions: m.quizQuestions ?? null,
    durationMin: m.durationMin,
    order: m.order,
    isRequired: m.isRequired,
    isActive: m.isActive,
    createdAt: m.createdAt.toISOString(),
    completedCount: stats?.completed ?? 0,
    progressCount: stats?.total ?? 0,
  };
}

export async function GET() {
  await requireSuperAdmin();

  const [modules, completedGroups, totalGroups] = await Promise.all([
    prisma.trainingModule.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'desc' }] }),
    prisma.riderTrainingProgress.groupBy({
      by: ['moduleId'],
      where: { completed: true },
      _count: { _all: true },
    }),
    prisma.riderTrainingProgress.groupBy({
      by: ['moduleId'],
      _count: { _all: true },
    }),
  ]);

  const completedMap = new Map(completedGroups.map((g) => [g.moduleId, g._count._all]));
  const totalMap = new Map(totalGroups.map((g) => [g.moduleId, g._count._all]));

  return Response.json({
    modules: modules.map((m) =>
      serializeModule(m, {
        completed: completedMap.get(m.id) ?? 0,
        total: totalMap.get(m.id) ?? 0,
      })
    ),
  });
}

const CreateBody = z.object({
  title: z.string().min(2).max(160),
  summary: z.string().max(500).nullable().optional(),
  category: z.enum(CATEGORIES),
  contentBody: z.string().min(1),
  quizQuestions: z.any().optional(),
  durationMin: z.number().int().min(1).max(600),
  order: z.number().int().min(0).max(9999).optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  await requireSuperAdmin();
  const session = await auth();
  const data = CreateBody.parse(await req.json());

  const created = await prisma.trainingModule.create({
    data: {
      title: data.title,
      summary: data.summary ?? null,
      category: data.category,
      contentBody: data.contentBody,
      quizQuestions: data.quizQuestions ?? undefined,
      durationMin: data.durationMin,
      order: data.order ?? 0,
      isRequired: data.isRequired ?? false,
      isActive: data.isActive ?? true,
    },
  });

  await audit('training.module.create', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'TrainingModule',
    entityId: created.id,
    after: serializeModule(created),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ module: serializeModule(created) }, { status: 201 });
}
