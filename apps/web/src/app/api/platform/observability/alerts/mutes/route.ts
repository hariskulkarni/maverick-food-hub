/**
 * /api/platform/observability/alerts/mutes — super-admin + 2FA.
 *   POST   { key, minutes, reason? } → mute notifications for a rule ("stuck_orders")
 *          or one alert key ("job_overdue:kyc-expiry") for 5 min … 7 days.
 *   DELETE ?key=…                   → unmute.
 * Mutes silence e-mail/SMS only; the alert still shows as firing.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireObservabilityApi } from '@/server/observability/access';
import { jsonError } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9_]+(?::[A-Za-z0-9_.:/[\]-]+)?$/),
  minutes: z.number().int().min(5).max(7 * 24 * 60),
  reason: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'Provide a valid key and minutes (5 – 10080)');
  const until = new Date(Date.now() + parsed.data.minutes * 60_000);
  const row = await prisma.obsAlertMute.upsert({
    where: { key: parsed.data.key },
    create: { key: parsed.data.key, until, reason: parsed.data.reason ?? null, createdBy: gate.userId },
    update: { until, reason: parsed.data.reason ?? null, createdBy: gate.userId },
  });
  await audit('observability.alert.mute', {
    actorId: gate.userId,
    actorRole: 'SUPER_ADMIN',
    entityType: 'ObsAlertMute',
    entityId: row.key,
    after: { until: until.toISOString(), reason: row.reason },
  });
  return Response.json({ key: row.key, until: row.until.toISOString() });
}

export async function DELETE(req: NextRequest) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const key = req.nextUrl.searchParams.get('key')?.slice(0, 120);
  if (!key) return jsonError(400, 'key is required');
  const { count } = await prisma.obsAlertMute.deleteMany({ where: { key } });
  if (count) await audit('observability.alert.unmute', { actorId: gate.userId, actorRole: 'SUPER_ADMIN', entityType: 'ObsAlertMute', entityId: key });
  return Response.json({ key, removed: count });
}
