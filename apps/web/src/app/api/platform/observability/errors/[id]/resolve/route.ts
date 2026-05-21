/**
 * POST /api/platform/observability/errors/[id]/resolve — super-admin.
 * Marks an error resolved (acknowledged). Body: { resolved?: boolean } (default true).
 * A resolved error that recurs is automatically re-opened by recordError().
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  let resolved = true;
  try {
    const body = await req.json();
    if (typeof body?.resolved === 'boolean') resolved = body.resolved;
  } catch {
    /* empty body = resolve */
  }
  const row = await prisma.obsErrorLog.update({
    where: { id },
    data: { resolvedAt: resolved ? new Date() : null },
    select: { id: true, resolvedAt: true },
  });
  return Response.json({ id: row.id, resolvedAt: row.resolvedAt?.toISOString() ?? null });
}
