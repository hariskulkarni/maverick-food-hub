/** GET /api/help/articles?appArea=&category=&lang= — published article summaries visible to the caller. */
import { auth } from '@/server/auth';
import { handleArticles } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handleArticles(req, await auth());
}
