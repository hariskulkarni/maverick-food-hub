/**
 * /api/admin/integrations/novaryq — Novaryq POS settings for the caller's restaurant.
 *   GET    overview (masked credentials, health, branches ↔ locations, sync counts, webhook URL)
 *   PUT    save credentials (test first; blank secrets keep the stored ones)
 *   DELETE disconnect
 * Restaurant ADMIN membership only (novaryqAdminGate); writes need NOVARYQ_INTEGRATION_ENABLED.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { disconnectNovaryq, novaryqAdminGate, novaryqOverview, saveNovaryqCredentials } from '@/server/novaryq/admin';

export const dynamic = 'force-dynamic';

const Body = z.object({
  baseUrl: z.string().trim().min(1).max(200),
  clientId: z.string().trim().min(1).max(200),
  secret: z.string().max(500).optional(),
  webhookSecret: z.string().max(500).optional(),
  enabled: z.boolean(),
});

export async function GET(req: NextRequest) {
  const ctx = await novaryqAdminGate({}, req.nextUrl.searchParams.get('restaurantId'));
  if (ctx instanceof Response) return ctx;
  return Response.json(await novaryqOverview(ctx.restaurantId));
}

export async function PUT(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true }, req.nextUrl.searchParams.get('restaurantId'));
  if (ctx instanceof Response) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Novaryq URL, API key and enabled are required.' }, { status: 400 });
  const r = await saveNovaryqCredentials(ctx, parsed.data);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}

export async function DELETE(req: NextRequest) {
  const ctx = await novaryqAdminGate({ write: true }, req.nextUrl.searchParams.get('restaurantId'));
  if (ctx instanceof Response) return ctx;
  await disconnectNovaryq(ctx);
  return Response.json({ ok: true });
}
