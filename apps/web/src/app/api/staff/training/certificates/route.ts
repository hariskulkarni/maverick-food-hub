/** GET /api/staff/training/certificates — the signed-in staff member's certificates. */
import { NextRequest } from 'next/server';
import { staffLearner } from '@/server/training/learner-auth';
import { listCertificates } from '@/server/training/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await staffLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  return Response.json(await listCertificates(who.learner, who.lang));
}
