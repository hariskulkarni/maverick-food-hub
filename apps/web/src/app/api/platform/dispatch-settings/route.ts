/**
 * Dispatch settings (JIT rider invitations) — platform-wide, super admin.
 *   GET — current config + bounds + defaults
 *   PUT — partial update; clamped; audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';
import { getJitConfig, setJitConfig, JIT_DEFAULTS, JIT_BOUNDS } from '@/server/dispatch/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

async function gate() {
  try {
    return await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export async function GET() {
  const s = await gate();
  if (s instanceof Response) return s;
  return Response.json({ jit: await getJitConfig(), defaults: JIT_DEFAULTS, bounds: JIT_BOUNDS }, { headers: NO_STORE });
}

const Body = z.object({
  enabled: z.boolean().optional(),
  bufferMin: z.number().finite().optional(),
  roadFactor: z.number().finite().optional(),
  speedKph: z.number().finite().optional(),
  rangeKm: z.number().finite().optional(),
  promiseSlaMin: z.number().finite().optional(),
}).strict();

export async function PUT(req: NextRequest) {
  const s = await gate();
  if (s instanceof Response) return s;
  const body = parseOrJsonError(Body, await req.json().catch(() => null));
  if (body instanceof Response) return body;
  const before = await getJitConfig();
  const jit = await setJitConfig(body);
  await audit('platform.dispatch_jit.update', {
    actorId: s.user.id,
    actorRole: s.user.role,
    entityType: 'PlatformSettings',
    before: { ...before },
    after: { ...jit },
  });
  return Response.json({ jit }, { headers: NO_STORE });
}
