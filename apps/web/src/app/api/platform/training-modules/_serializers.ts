/**
 * Serializer for TrainingModule rows. Lives outside `route.ts` because a
 * Next.js route file may only export HTTP handlers + route config.
 *
 * Returns BOTH the v2 fields (audience, version, lesson/question counts) AND
 * the legacy `contentBlocks` / `contentBody` fallback.
 */
import { parseContentBlocks } from '@/server/training-cms';

export interface ModuleStats {
  /** Learners holding a certificate for the CURRENT version. */
  completed: number;
  /** Learners who have started (any lesson completion or attempt) the current version. */
  total: number;
}

export function serializeModule(m: any, stats?: ModuleStats) {
  return {
    id: m.id,
    slug: m.slug ?? null,
    title: m.title,
    summary: m.summary ?? null,
    category: m.category,
    audience: m.audience ?? 'RIDER',
    contentBody: m.contentBody,
    contentBlocks: parseContentBlocks(m.contentBlocks),
    contentVersion: m.contentVersion ?? 1,
    heroImageUrl: m.heroImageUrl ?? null,
    quizQuestions: m.quizQuestions ?? null,
    durationMin: m.durationMin,
    order: m.order,
    isRequired: m.isRequired,
    isActive: m.isActive,
    blocksShift: m.blocksShift ?? false,
    version: m.version ?? 1,
    versionPublishedAt: m.versionPublishedAt ? new Date(m.versionPublishedAt).toISOString() : null,
    passMarkPct: m.passMarkPct ?? 80,
    lessonsCount: m._count?.lessons ?? 0,
    questionCount: m._count?.questions ?? 0,
    hasHindi: !!(m.translations && typeof m.translations === 'object' && (m.translations as any).hi?.title),
    createdAt: new Date(m.createdAt).toISOString(),
    completedCount: stats?.completed ?? 0,
    progressCount: stats?.total ?? 0,
  };
}
