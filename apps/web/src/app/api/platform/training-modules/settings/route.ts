/**
 * Training platform settings.
 *   GET (cms:read)     — { shiftGate }
 *   PUT (super-admin)  — { shiftGate: boolean } — when on, riders cannot go
 *                         online until shift-blocking safety modules are passed.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireCapabilityApi, requireSuperAdminApi } from '@/server/api-auth';
import { audit } from '@/server/audit';
import { parseOrJsonError } from '@/server/zod-helpers';
import { getTrainingShiftGate, setTrainingShiftGate } from '@/server/platform-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await requireCapabilityApi('cms:read');
  if (gate instanceof Response) return gate;
  return Response.json({ shiftGate: await getTrainingShiftGate() });
}

export async function PUT(req: NextRequest) {
  const gate = await requireSuperAdminApi();
  if (gate instanceof Response) return gate;
  const data = parseOrJsonError(z.object({ shiftGate: z.boolean() }), await req.json().catch(() => null));
  if (data instanceof Response) return data;
  const before = await getTrainingShiftGate();
  const shiftGate = await setTrainingShiftGate(data.shiftGate);
  await audit('training.settings.update', {
    actorId: gate.user.id,
    actorRole: gate.user.role,
    entityType: 'PlatformSetting',
    entityId: 'trainingShiftGate',
    before: { shiftGate: before },
    after: { shiftGate },
  });
  return Response.json({ shiftGate });
}
