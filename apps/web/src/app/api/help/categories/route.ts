/** GET /api/help/categories?lang= — help categories + article summaries visible to the caller (signed out = customer). */
import { auth } from '@/server/auth';
import { handleCategories } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handleCategories(req, await auth());
}
