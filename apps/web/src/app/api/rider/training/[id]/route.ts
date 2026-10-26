/**
 * GET  /api/rider/training/[id]?lang= — one module: lessons, quiz (without
 *      answers), this rider's progress + retake eligibility, plus the legacy
 *      contentBlocks/contentBody/progress fields older app builds render.
 * POST /api/rider/training/[id] — legacy "complete module" used by pre-v2
 *      builds (they grade their inline quiz locally and send `quizScore`).
 *      Enforced with the same pass mark + retake rules; see legacyComplete().
 */
import { NextRequest } from 'next/server';
import { riderLearner, actionResponse } from '@/server/training/learner-auth';
import { getLearnerModule, legacyComplete } from '@/server/training/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await riderLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  const mod = await getLearnerModule(who.learner, id, who.lang);
  if (!mod) return new Response('Not found', { status: 404 });
  return Response.json(mod);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const who = await riderLearner(null);
  if (who instanceof Response) return who;
  let body: { quizScore?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {}; // empty body = complete without a quiz
  }
  const score = typeof body.quizScore === 'number' && Number.isFinite(body.quizScore) ? body.quizScore : null;
  return actionResponse(await legacyComplete(who.learner, id, score));
}
