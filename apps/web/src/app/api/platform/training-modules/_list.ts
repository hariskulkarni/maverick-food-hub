/** Module list + per-module stats, shared by the list route and the page. */
import { prisma } from '@/server/db';
import { serializeModule } from './_serializers';

export async function listModulesWithStats() {
  const modules = await prisma.trainingModule.findMany({
    orderBy: [{ audience: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
    include: { _count: { select: { lessons: true, questions: true } } },
  });
  const [certs, starters] = await Promise.all([
    prisma.trainingCertificate.findMany({ select: { moduleId: true, moduleVersion: true } }),
    prisma.trainingLessonCompletion.findMany({ select: { moduleId: true, moduleVersion: true, userId: true }, distinct: ['moduleId', 'userId'] }),
  ]);
  const version = new Map(modules.map((m) => [m.id, m.version]));
  const completed = new Map<string, number>();
  for (const c of certs) if (version.get(c.moduleId) === c.moduleVersion) completed.set(c.moduleId, (completed.get(c.moduleId) ?? 0) + 1);
  const started = new Map<string, number>();
  for (const s of starters) if (version.get(s.moduleId) === s.moduleVersion) started.set(s.moduleId, (started.get(s.moduleId) ?? 0) + 1);
  return modules.map((m) =>
    serializeModule(m, { completed: completed.get(m.id) ?? 0, total: Math.max(started.get(m.id) ?? 0, completed.get(m.id) ?? 0) }),
  );
}
