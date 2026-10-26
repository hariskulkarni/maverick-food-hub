/** POST /api/admin/integrations/novaryq/import { branchId } — import the linked location's Novaryq menu and link every item. */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { audit } from '@/server/audit';
import { adminError, novaryqAdminGate } from '@/server/novaryq/admin';
import { importNovaryqMenu } from '@/server/novaryq/menu';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

const Body = z.object({ branchId: z.string().min(1).max(64) });

export async function POST(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true });
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'branchId is required.' }, { status: 400 });
  const branch = await prisma.branch.findFirst({ where: { id: parsed.data.branchId, restaurantId: ctx.restaurantId }, select: { id: true } });
  if (!branch) return Response.json({ error: 'Branch not found' }, { status: 404 });
  try {
    const result = await importNovaryqMenu(ctx.restaurantId, branch.id);
    await audit('integration.novaryq.import', { actorId: ctx.userId, restaurantId: ctx.restaurantId, entityType: 'Branch', entityId: branch.id, after: result });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    return adminError(e);
  }
}
