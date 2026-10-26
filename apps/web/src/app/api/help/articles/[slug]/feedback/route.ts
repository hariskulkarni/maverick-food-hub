/** POST /api/help/articles/[slug]/feedback { helpful, comment? } — signed-in viewer's vote (one per user, upserted). */
import { auth } from '@/server/auth';
import { handleFeedback } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleFeedback(req, await auth(), (await params).slug);
}
