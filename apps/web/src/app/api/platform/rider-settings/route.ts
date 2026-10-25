/**
 * GET / PATCH /api/platform/rider-settings — super-admin rider operations knobs
 * (rider audit r3; UI: /platform/rider-settings):
 *   kycGate          — require approved, in-date KYC to go online / get orders (default true)
 *   maxActiveOrders  — concurrent active deliveries per rider, 1–10 (default 2)
 *   dailyGoal / weeklyGoal — ₹ goals on the rider app's Earnings tab (1500 / 9000)
 *   trainingShiftGate — riders must pass shift-blocking safety modules before
 *                       going online (default false; same flag as
 *                       PUT /api/platform/training-modules/settings)
 * Audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import {
  getRiderOpsSettings,
  setRiderOpsSettings,
  getTrainingShiftGate,
  setTrainingShiftGate,
} from '@/server/platform-settings';
import { audit } from '@/server/audit';
import { clientIp } from '@/server/http/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z
  .object({
    kycGate: z.boolean().optional(),
    maxActiveOrders: z.number().int().min(1).max(10).optional(),
    dailyGoal: z.number().positive().max(100000).optional(),
    weeklyGoal: z.number().positive().max(1000000).optional(),
    trainingShiftGate: z.boolean().optional()
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

async function readAll() {
  const [ops, trainingShiftGate] = await Promise.all([getRiderOpsSettings(), getTrainingShiftGate()]);
  return { ...ops, trainingShiftGate };
}

export async function GET() {
  const session = await guard();
  if (session instanceof Response) return session;
  return Response.json(await readAll());
}

export async function PATCH(req: NextRequest) {
  const session = await guard();
  if (session instanceof Response) return session;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 });
  const { trainingShiftGate, ...ops } = parsed.data;
  const before = await readAll();
  if (Object.keys(ops).length > 0) await setRiderOpsSettings(ops);
  if (trainingShiftGate !== undefined) await setTrainingShiftGate(trainingShiftGate);
  const after = await readAll();
  await audit('platform.rider-settings.update', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'PlatformSettings',
    entityId: 'rider-ops',
    before: { ...before },
    after: { ...after },
    ipAddress: clientIp(req.headers)
  });
  return Response.json(after);
}
