/**
 * POST /api/platform/observability/errors/[id]/resolve — super-admin + 2FA.
 * Marks an error resolved (acknowledged). Body: { resolved?: boolean } (default true).
 * A resolved error that recurs is automatically re-opened by recordError().
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { audit } from '@/server/audit';
import { requireObservabilityApi } from '@/server/observability/access';
import { jsonError } from '@/server/observability/route-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireObservabilityApi();
  if (gate instanceof Response) return gate;
  const { id } = await params;
  let resolved = true;
  try {
    const body = await req.json();
    if (typeof body?.resolved === 'boolean') resolved = body.resolved;
  } catch {
    /* empty body = resolve */
  }
  const exists = await prisma.obsErrorLog.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError(404, 'Error group not found');
  const row = await prisma.obsErrorLog.update({
    where: { id },
    data: { resolvedAt: resolved ? new Date() : null },
    select: { id: true, resolvedAt: true },
  });
  await audit(resolved ? 'observability.error.resolve' : 'observability.error.reopen', {
    actorId: gate.userId,
    actorRole: 'SUPER_ADMIN',
    entityType: 'ObsErrorLog',
    entityId: id,
  });
  return Response.json({ id: row.id, resolvedAt: row.resolvedAt?.toISOString() ?? null });
}
