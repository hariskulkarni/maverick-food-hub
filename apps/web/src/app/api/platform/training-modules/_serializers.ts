/**
 * Serializer for TrainingModule rows. Lives outside `route.ts` because a
 * Next.js route file may only export HTTP handlers + route config.
 *
 * Returns BOTH the new `contentBlocks` array (rich block-based lesson) AND the
 * legacy `contentBody` plain-text fallback, so older rider-native clients on
 * unupgraded builds keep rendering something readable.
 */
import { parseContentBlocks } from '@/server/training-cms';

export function serializeModule(m: any, stats?: { completed: number; total: number }) {
  return {
    id: m.id,
    title: m.title,
    summary: m.summary ?? null,
    category: m.category,
    contentBody: m.contentBody,
    contentBlocks: parseContentBlocks(m.contentBlocks),
    contentVersion: m.contentVersion ?? 1,
    heroImageUrl: m.heroImageUrl ?? null,
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
