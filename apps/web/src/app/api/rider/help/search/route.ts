/** GET /api/rider/help/search?q=&lang= — rider-audience help search (Bearer token). */
import { auth } from '@/server/rider-auth';
import { forbidden } from '@/server/api-auth';
import { handleSearch } from '@/server/help/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await auth();
  if (session?.user?.role !== 'RIDER') return forbidden('Rider sign-in required.');
  return handleSearch(req, session, 'rider');
}
