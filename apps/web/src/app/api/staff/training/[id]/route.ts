/**
 * GET  /api/staff/training/[id]?lang= — one module with lessons, quiz and progress.
 * POST /api/staff/training/[id] — complete a module that has no lessons and no quiz.
 */
import { NextRequest } from 'next/server';
import { staffLearner, actionResponse } from '@/server/training/learner-auth';
import { getLearnerModule, legacyComplete } from '@/server/training/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await staffLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  const mod = await getLearnerModule(who.learner, id, who.lang);
  if (!mod) return Response.json({ error: 'Training module not found.' }, { status: 404 });
  return Response.json(mod);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await staffLearner(null);
  if (who instanceof Response) return who;
  // Staff clients grade quizzes on the server only — never accept a client score here.
  return actionResponse(await legacyComplete(who.learner, id, null));
}
