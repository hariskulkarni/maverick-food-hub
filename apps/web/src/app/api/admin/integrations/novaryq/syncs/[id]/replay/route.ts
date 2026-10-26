/** POST /api/admin/integrations/novaryq/syncs/[id]/replay — requeue a FAILED/DEAD push or cancel of this restaurant. */
import { NextRequest } from 'next/server';
import { novaryqAdminGate } from '@/server/novaryq/admin';
import { replaySync } from '@/server/novaryq/push';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await novaryqAdminGate({ write: true }, req.nextUrl.searchParams.get('restaurantId'));
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const r = await replaySync(ctx.restaurantId, id, ctx.userId);
  return Response.json(r, { status: r.ok ? 200 : r.error === 'Not found' ? 404 : 409 });
}
