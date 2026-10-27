/**
 * GET / PATCH /api/platform/safety-alerts/settings — super-admin thresholds +
 * per-type toggles for the rider safety & anomaly alerts sweep
 * (server/safety/alerts.ts; UI: /platform/safety-alerts). Audited.
 *
 *   routeDeviation        { enabled, minutes, metres }
 *   etaBreach             { enabled, minutes }
 *   longWaitAtRestaurant  { enabled, minutes }
 *   signalLoss            { enabled, minutes }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { getSafetyAlertSettings, setSafetyAlertSettings } from '@/server/safety/settings';
import { audit } from '@/server/audit';
import { clientIp } from '@/server/http/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Minutes = z.number().int().min(1).max(240);
const Metres = z.number().int().min(50).max(5000);

const Body = z
  .object({
    routeDeviation: z.object({ enabled: z.boolean().optional(), minutes: Minutes.optional(), metres: Metres.optional() }).strict().optional(),
    etaBreach: z.object({ enabled: z.boolean().optional(), minutes: Minutes.optional() }).strict().optional(),
    longWaitAtRestaurant: z.object({ enabled: z.boolean().optional(), minutes: Minutes.optional() }).strict().optional(),
    signalLoss: z.object({ enabled: z.boolean().optional(), minutes: Minutes.optional() }).strict().optional(),
  })
  .strict();

type Session = Awaited<ReturnType<typeof requireSuperAdmin>>;

async function guard(): Promise<Session | Response> {
  try {
    return await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function GET() {
  const session = await guard();
  if (session instanceof Response) return session;
  return Response.json(await getSafetyAlertSettings());
}

export async function PATCH(req: NextRequest) {
  const session = await guard();
  if (session instanceof Response) return session;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 });
  const before = await getSafetyAlertSettings();
  const after = await setSafetyAlertSettings(parsed.data);
  await audit('platform.safety-alerts.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSettings',
    entityId: 'safety-alerts',
    before: { ...before },
    after: { ...after },
    ipAddress: clientIp(req.headers),
  });
  return Response.json(after);
}
