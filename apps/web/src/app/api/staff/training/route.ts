/**
 * GET /api/staff/training?lang= — training library for restaurant staff.
 * KITCHEN sees KITCHEN modules; ADMIN sees RESTAURANT_ADMIN (required) and
 * KITCHEN (optional) modules. Same response shape as /api/rider/training.
 */
import { NextRequest } from 'next/server';
import { staffLearner } from '@/server/training/learner-auth';
import { listLearnerModules } from '@/server/training/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await staffLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  return Response.json({ ...(await listLearnerModules(who.learner, who.lang)), lang: who.lang });
}
