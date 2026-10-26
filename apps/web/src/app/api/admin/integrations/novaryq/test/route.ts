/** POST /api/admin/integrations/novaryq/test — signed GET /menu with the stored credentials. */
import { NextRequest } from 'next/server';
import { novaryqAdminGate, testStoredConnection } from '@/server/novaryq/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true }, req.nextUrl.searchParams.get('restaurantId'));
  if (ctx instanceof Response) return ctx;
  return Response.json(await testStoredConnection(ctx.restaurantId));
}
