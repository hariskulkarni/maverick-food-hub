/** POST /api/admin/integrations/novaryq/test — signed GET /menu with the stored credentials. */
import { novaryqAdminGate, testStoredConnection } from '@/server/novaryq/admin';

export const dynamic = 'force-dynamic';

export async function POST() {
  const ctx = await novaryqAdminGate({ write: true });
  if (ctx instanceof Response) return ctx;
  return Response.json(await testStoredConnection(ctx.restaurantId));
}
