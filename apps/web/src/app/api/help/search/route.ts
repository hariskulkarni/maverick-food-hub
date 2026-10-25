/** GET /api/help/search?q=&lang= — ranked full-text search with highlights; logged for content-gap reports. */
import { auth } from '@/server/auth';
import { handleSearch } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return handleSearch(req, await auth(), 'web');
}
