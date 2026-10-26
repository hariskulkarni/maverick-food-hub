/**
 * PUT /api/admin/integrations/novaryq/menu-master { on, allowPriceOverride }
 * "POS: Novaryq" — Novaryq becomes the menu master for linked items (ADR-FNI-001 §4.2).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { novaryqAdminGate, setMenuMaster } from '@/server/novaryq/admin';

export const dynamic = 'force-dynamic';

const Body = z.object({ on: z.boolean(), allowPriceOverride: z.boolean().default(false) });

export async function PUT(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true });
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'on is required.' }, { status: 400 });
  const r = await setMenuMaster(ctx, parsed.data);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
