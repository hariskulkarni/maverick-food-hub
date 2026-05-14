/**
 * GET /api/rider/training
 *
 * The training & certification catalogue for the native app — every active
 * TrainingModule (ordered) merged with this rider's completion progress, plus
 * roll-up counts the progress header needs.
 */
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const modules = await prisma.trainingModule.findMany({
    where: { isActive: true },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      title: true,
      summary: true,
      category: true,
      durationMin: true,
      order: true,
      isRequired: true,
      progress: {
        where: { riderId: profile.id },
        select: { completed: true, completedAt: true, quizScore: true },
      },
    },
  });

  const merged = modules.map((m) => {
    const p = m.progress[0] ?? null;
    return {
      id: m.id,
      title: m.title,
      summary: m.summary,
      category: m.category,
      durationMin: m.durationMin,
      order: m.order,
      isRequired: m.isRequired,
      completed: p?.completed ?? false,
      completedAt: p?.completedAt?.toISOString() ?? null,
      quizScore: p?.quizScore ?? null,
    };
  });

  const completedCount = merged.filter((m) => m.completed).length;
  const requiredRemaining = merged.filter(
    (m) => m.isRequired && !m.completed
  ).length;

  return Response.json({
    modules: merged,
    completedCount,
    totalCount: merged.length,
    requiredRemaining,
  });
}
