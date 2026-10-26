/** GET /api/platform/help/analytics?days=30 — views, helpful %, top & zero-result searches. SUPER_ADMIN only. */
import { requireSuperAdminApi } from '@/server/api-auth';
import { helpAnalytics } from '@/server/help/authoring';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 30, 1), 365);
  return Response.json(await helpAnalytics(days));
}
