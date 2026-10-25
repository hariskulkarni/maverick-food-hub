/**
 * GET /api/rider/training?lang=en|hi
 *
 * The rider's training library: every active RIDER module merged with this
 * rider's progress/certification, plus roll-up counts. Backward compatible —
 * pre-v2 app builds read `modules[].{completed,quizScore,isRequired}`,
 * `completedCount`, `totalCount`, `requiredRemaining`.
 */
import { NextRequest } from 'next/server';
import { riderLearner } from '@/server/training/learner-auth';
import { listLearnerModules } from '@/server/training/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await riderLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  return Response.json({ ...(await listLearnerModules(who.learner, who.lang)), lang: who.lang });
}
