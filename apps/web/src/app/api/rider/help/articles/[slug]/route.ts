/** GET /api/rider/help/articles/[slug]?lang= — one rider-visible article incl. parsed blocks (Bearer token). */
import { auth } from '@/server/rider-auth';
import { forbidden } from '@/server/api-auth';
import { handleArticle } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'RIDER') return forbidden('Rider sign-in required.');
  return handleArticle(req, session, (await params).slug);
}
