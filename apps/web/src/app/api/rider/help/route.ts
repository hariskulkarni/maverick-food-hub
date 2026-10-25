/**
 * GET /api/rider/help?lang= — rider help categories with article summaries.
 * Bearer token (rider-auth); non-riders get 403.
 */
import { auth } from '@/server/rider-auth';
import { forbidden } from '@/server/api-auth';
import { handleCategories } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== 'RIDER') return forbidden('Rider sign-in required.');
  return handleCategories(req, session);
}
