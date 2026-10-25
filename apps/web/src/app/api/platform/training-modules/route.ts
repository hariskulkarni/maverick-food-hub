/**
 * Training modules — platform list + create.
 *   GET  (cms:read)  — every module with lesson/question counts and completion stats.
 *   POST (cms:write) — create a module (settings only); content is added in the editor.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireCapabilityApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';
import { ModuleSettingsSchema } from '@/server/training/authoring';
import { serializeModule } from './_serializers';
import { listModulesWithStats } from './_list';
import { clientIp } from '@/server/http/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireCapabilityApi('cms:read');
  if (gate instanceof Response) return gate;
  return Response.json({ modules: await listModulesWithStats() });
}

const CreateBody = ModuleSettingsSchema.partial().required({ title: true, audience: true, category: true });

export async function POST(req: NextRequest) {
  const gate = await requireCapabilityApi('cms:write');
  if (gate instanceof Response) return gate;
  const session = gate;
  const data = parseOrJsonError(CreateBody, await req.json().catch(() => null));
  if (data instanceof Response) return data;

  const created = await prisma.trainingModule.create({
    data: {
      title: data.title,
      summary: data.summary ?? null,
      category: data.category,
      audience: data.audience,
      contentBody: data.summary?.trim() || data.title,
      heroImageUrl: data.heroImageUrl ?? null,
      durationMin: data.durationMin ?? 10,
      order: data.order ?? 0,
      isRequired: data.isRequired ?? false,
      // New modules start unpublished so learners never see an empty module.
      isActive: data.isActive ?? false,
      blocksShift: data.blocksShift ?? false,
      passMarkPct: data.passMarkPct ?? 80,
      maxAttempts: data.maxAttempts ?? null,
      retakeCooldownMin: data.retakeCooldownMin ?? 0,
      dueDays: data.dueDays ?? 7,
      contentVersion: 2,
    },
    include: { _count: { select: { lessons: true, questions: true } } },
  });

  await audit('training.module.create', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'TrainingModule',
    entityId: created.id,
    after: serializeModule(created),
    ipAddress: clientIp(req.headers) ?? null,
    userAgent: req.headers.get('user-agent') ?? null,
  });

  return Response.json({ module: serializeModule(created) }, { status: 201 });
}
