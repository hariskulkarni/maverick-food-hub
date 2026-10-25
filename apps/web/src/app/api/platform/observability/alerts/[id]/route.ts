/**
 * POST /api/platform/observability/alerts/[id] — super-admin + 2FA.
 * Body: { action: 'ack' | 'unack' }. Acknowledging stops reminder notifications
 * for this alert instance; a new instance (after it resolves and re-fires) notifies again.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireObservabilityApi } from '@/server/observability/access';
import { jsonError } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ action: z.enum(['ack', 'unack']) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'action must be "ack" or "unack"');
  const existing = await prisma.obsAlert.findUnique({ where: { id }, select: { id: true, ruleKey: true } });
  if (!existing) return jsonError(404, 'Alert not found');
  const ack = parsed.data.action === 'ack';
  const row = await prisma.obsAlert.update({
    where: { id },
    data: { acknowledgedAt: ack ? new Date() : null, acknowledgedBy: ack ? gate.userId : null },
    select: { id: true, acknowledgedAt: true },
  });
  await audit(ack ? 'observability.alert.ack' : 'observability.alert.unack', {
    actorId: gate.userId,
    actorRole: 'SUPER_ADMIN',
    entityType: 'ObsAlert',
    entityId: id,
    after: { ruleKey: existing.ruleKey },
  });
  return Response.json({ id: row.id, acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null });
}
