/**
 * GET  /api/rider/training/[id] — one training module with this rider's
 *      progress and (if any) quiz questions.
 * POST /api/rider/training/[id] — mark the module complete (upsert progress),
 *      optionally recording a quiz score. Returns the updated progress.
 */
import { NextRequest } from 'next/server';
import { auth } from '@/server/rider-auth';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const module = await prisma.trainingModule.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      summary: true,
      category: true,
      contentBody: true,
      quizQuestions: true,
      durationMin: true,
      isRequired: true,
      isActive: true,
      progress: {
        where: { riderId: profile.id },
        select: { completed: true, completedAt: true, quizScore: true },
      },
    },
  });
  if (!module || !module.isActive) return new Response('Not found', { status: 404 });

  const p = module.progress[0] ?? null;
  return Response.json({
    id: module.id,
    title: module.title,
    summary: module.summary,
    category: module.category,
    contentBody: module.contentBody,
    quizQuestions: module.quizQuestions ?? null,
    durationMin: module.durationMin,
    isRequired: module.isRequired,
    progress: {
      completed: p?.completed ?? false,
      completedAt: p?.completedAt?.toISOString() ?? null,
      quizScore: p?.quizScore ?? null,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await auth();
  if (session?.user.role !== 'RIDER') return new Response('Forbidden', { status: 403 });

  const profile = await prisma.riderProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  if (!profile) return new Response('No rider profile', { status: 404 });

  const module = await prisma.trainingModule.findUnique({
    where: { id },
    select: { id: true, isActive: true },
  });
  if (!module || !module.isActive) return new Response('Not found', { status: 404 });

  let body: { quizScore?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine — completing without a quiz is allowed.
    body = {};
  }

  let quizScore: number | null = null;
  if (typeof body.quizScore === 'number' && Number.isFinite(body.quizScore)) {
    quizScore = Math.max(0, Math.min(100, Math.round(body.quizScore)));
  }

  const now = new Date();
  const progress = await prisma.riderTrainingProgress.upsert({
    where: { moduleId_riderId: { moduleId: id, riderId: profile.id } },
    create: {
      moduleId: id,
      riderId: profile.id,
      completed: true,
      completedAt: now,
      quizScore,
    },
    update: {
      completed: true,
      completedAt: now,
      ...(quizScore !== null ? { quizScore } : {}),
    },
    select: { completed: true, completedAt: true, quizScore: true },
  });

  return Response.json({
    completed: progress.completed,
    completedAt: progress.completedAt?.toISOString() ?? null,
    quizScore: progress.quizScore,
  });
}
