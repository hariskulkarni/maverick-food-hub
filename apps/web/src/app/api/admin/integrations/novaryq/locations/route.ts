/**
 * /api/admin/integrations/novaryq/locations — branch ↔ Novaryq location mapping.
 *   PUT    { branchId, novaryqLocationId }  (refused unless the location's currency is INR)
 *   DELETE ?branchId=
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { novaryqAdminGate, removeBranchLocation, setBranchLocation } from '@/server/novaryq/admin';

export const dynamic = 'force-dynamic';

const Body = z.object({ branchId: z.string().min(1).max(64), novaryqLocationId: z.string().trim().min(1).max(64) });

export async function PUT(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true }, req.nextUrl.searchParams.get('restaurantId'));
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'branchId and novaryqLocationId are required.' }, { status: 400 });
  const r = await setBranchLocation(ctx, parsed.data.branchId, parsed.data.novaryqLocationId);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}

export async function DELETE(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true }, req.nextUrl.searchParams.get('restaurantId'));
  if (ctx instanceof Response) return ctx;
  const branchId = req.nextUrl.searchParams.get('branchId');
  if (!branchId) return Response.json({ error: 'branchId is required.' }, { status: 400 });
  return Response.json(await removeBranchLocation(ctx, branchId));
}
