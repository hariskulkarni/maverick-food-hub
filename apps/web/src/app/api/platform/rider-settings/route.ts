/**
 * GET / PATCH /api/platform/rider-settings — super-admin rider operations knobs
 * (rider audit r3):
 *   kycGate          — require approved, in-date KYC to go online / get orders (default true)
 *   maxActiveOrders  — concurrent active deliveries per rider, 1–10 (default 2)
 *   dailyGoal / weeklyGoal — ₹ goals on the rider app's Earnings tab (1500 / 9000)
 * Audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { getRiderOpsSettings, setRiderOpsSettings } from '@/server/platform-settings';
import { audit } from '@/server/audit';
import { clientIp } from '@/server/http/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    kycGate: z.boolean().optional(),
    maxActiveOrders: z.number().int().min(1).max(10).optional(),
    dailyGoal: z.number().positive().max(100000).optional(),
    weeklyGoal: z.number().positive().max(1000000).optional()
  })
  .strict();

async function guard() {
  try {
    return { session: await requireSuperAdmin() };
  } catch (e) {
    if (e instanceof Response) return { error: e };
    throw e;
  }
}

export async function GET() {
  const g = await guard();
  if ('error' in g) return g.error;
  return Response.json(await getRiderOpsSettings());
}

export async function PATCH(req: NextRequest) {
  const g = await guard();
  if ('error' in g) return g.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 });
  const before = await getRiderOpsSettings();
  const after = await setRiderOpsSettings(parsed.data);
  await audit('platform.rider-settings.update', {
    actorId: g.session.user.id,
    actorRole: g.session.user.role,
    entityType: 'PlatformSettings',
    entityId: 'rider-ops',
    before: { ...before },
    after: { ...after },
    ipAddress: clientIp(req.headers)
  });
  return Response.json(after);
}
