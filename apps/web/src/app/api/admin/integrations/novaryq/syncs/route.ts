/** GET /api/admin/integrations/novaryq/syncs[?state=FAILED] — order push log + latest inbound webhook events. */
import { NextRequest } from 'next/server';
import { novaryqAdminGate, syncLog } from '@/server/novaryq/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await novaryqAdminGate();
  if (ctx instanceof Response) return ctx;
  return Response.json(await syncLog(ctx.restaurantId, req.nextUrl.searchParams.get('state')));
}
