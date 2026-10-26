/** POST /api/staff/training/[id]/quiz — server-graded quiz submission. */
import { NextRequest } from 'next/server';
import { staffLearner, actionResponse } from '@/server/training/learner-auth';
import { submitQuiz } from '@/server/training/service';
import { QuizSubmissionSchema } from '@/server/training/http-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await staffLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  const parsed = QuizSubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Send answers as { answers: { questionId: optionIndex } }.' }, { status: 400 });
  return actionResponse(await submitQuiz(who.learner, id, parsed.data.answers, who.lang));
}
