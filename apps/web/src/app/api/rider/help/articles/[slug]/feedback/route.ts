/** POST /api/rider/help/articles/[slug]/feedback { helpful, comment? } — rider's vote (Bearer token). */
import { auth } from '@/server/rider-auth';
import { forbidden } from '@/server/api-auth';
import { handleFeedback } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'RIDER') return forbidden('Rider sign-in required.');
  return handleFeedback(req, session, (await params).slug);
}
