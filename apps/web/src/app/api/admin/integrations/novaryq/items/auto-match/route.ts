/** POST /api/admin/integrations/novaryq/items/auto-match { branchId } — link every unambiguous exact-name match. */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminError, novaryqAdminGate } from '@/server/novaryq/admin';
import { applyAutoMatch } from '@/server/novaryq/menu';
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
    return Response.json({ ok: true, ...(await applyAutoMatch(ctx.restaurantId, branch.id)) });
  } catch (e) {
    return adminError(e);
  }
}
