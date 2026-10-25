/** GET /api/rider/training/certificates — this rider's certificates (newest first). */
import { NextRequest } from 'next/server';
import { riderLearner } from '@/server/training/learner-auth';
import { listCertificates } from '@/server/training/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await riderLearner(req.nextUrl.searchParams.get('lang'));
  if (who instanceof Response) return who;
  return Response.json(await listCertificates(who.learner, who.lang));
}
