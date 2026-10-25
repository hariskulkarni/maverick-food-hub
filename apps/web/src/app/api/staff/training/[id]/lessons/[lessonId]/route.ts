/** POST /api/staff/training/[id]/lessons/[lessonId] — mark a lesson complete. */
import { NextRequest } from 'next/server';
import { staffLearner, actionResponse } from '@/server/training/learner-auth';
import { completeLesson } from '@/server/training/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  const who = await staffLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  return actionResponse(await completeLesson(who.learner, id, lessonId, who.lang));
}
