/** GET /api/help/articles/[slug]?lang= — one published article (404 when not visible to the caller). */
import { auth } from '@/server/auth';
import { handleArticle } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleArticle(req, await auth(), (await params).slug);
}
