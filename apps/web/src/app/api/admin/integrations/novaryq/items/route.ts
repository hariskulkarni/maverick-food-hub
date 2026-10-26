/**
 * /api/admin/integrations/novaryq/items
 *   GET ?branchId=  Flavrly items of the branch, their Novaryq links, the live Novaryq menu, auto-match suggestions
 *   PUT { menuItemId, itemCode | null }  link / unlink one item
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminError, novaryqAdminGate } from '@/server/novaryq/admin';
import { itemMappingView, linkItem } from '@/server/novaryq/menu';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

const Body = z.object({ menuItemId: z.string().min(1).max(64), itemCode: z.string().max(64).nullable() });

export async function GET(req: NextRequest) {
  const ctx = await novaryqAdminGate();
  if (ctx instanceof Response) return ctx;
  const branchId = req.nextUrl.searchParams.get('branchId') ?? '';
  const branch = await prisma.branch.findFirst({ where: { id: branchId, restaurantId: ctx.restaurantId }, select: { id: true } });
  if (!branch) return Response.json({ error: 'Branch not found' }, { status: 404 });
  try {
    return Response.json(await itemMappingView(ctx.restaurantId, branch.id));
  } catch (e) {
    return adminError(e);
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true });
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'menuItemId and itemCode are required.' }, { status: 400 });
  const r = await linkItem(ctx.restaurantId, parsed.data.menuItemId, parsed.data.itemCode);
  return Response.json(r, { status: r.ok ? 200 : r.error === 'Menu item not found' ? 404 : 422 });
}
