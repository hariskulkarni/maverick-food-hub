/**
 * Super-admin decision on a restaurant's Flavrly PG feature request.
 * Writes straight to the DB (no caching on the status read path), so the next
 * provider read reflects it immediately.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/integrations';
import { audit } from '@/server/audit';
import { requireSuperAdmin } from '@/server/tenancy';

export const dynamic = 'force-dynamic';

const Body = z.object({ decision: z.enum(['APPROVE', 'REJECT', 'DISABLE', 'RESET']) });
const STATUS = { APPROVE: 'APPROVED', REJECT: 'REJECTED', DISABLE: 'DISABLED' } as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ restaurantId: string }> }) {
  let session;
  try {
    session = await requireSuperAdmin();
  } catch (e) {
    if (e instanceof Response) return Response.json({ error: 'Forbidden' }, { status: 403 });
    throw e;
  }
  const { restaurantId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'decision must be APPROVE, REJECT, DISABLE or RESET' }, { status: 400 });
  const { decision } = parsed.data;

  if (decision === 'RESET') {
    // Clears a REJECTED/DISABLED decision so the restaurant may request again (T-15).
    const before = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId }, select: { id: true, status: true } });
    if (!before || (before.status !== 'REJECTED' && before.status !== 'DISABLED')) {
      return Response.json({ error: 'Only a REJECTED or DISABLED request can be reset' }, { status: 409 });
    }
    await prisma.youpiFeatureRequest.delete({ where: { restaurantId } });
    await audit('youpi.reset', {
      actorId: session.user.id,
      actorRole: session.user.role,
      restaurantId,
      entityType: 'YoupiFeatureRequest',
      entityId: before.id,
      before: { status: before.status },
      after: null,
    });
    return Response.json({ ok: true, restaurantId, status: 'NONE' });
  }

  if (decision === 'APPROVE' && !(await getConfig('__platform__', 'YOUPI'))) {
    return Response.json({ error: 'Configure the Flavrly PG connection first' }, { status: 409 });
  }

  const exists = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true } });
  if (!exists) return new Response('No such restaurant', { status: 404 });

  const before = await prisma.youpiFeatureRequest.findUnique({ where: { restaurantId }, select: { status: true } });
  const status = STATUS[decision];
  const now = new Date();
  const row = await prisma.youpiFeatureRequest.upsert({
    where: { restaurantId },
    update: { status, decidedById: session.user.id, decidedAt: now },
    create: { restaurantId, status, decidedById: session.user.id, decidedAt: now },
  });
  await audit(`youpi.${decision.toLowerCase()}`, {
    actorId: session.user.id,
    actorRole: session.user.role,
    restaurantId,
    entityType: 'YoupiFeatureRequest',
    entityId: row.id,
    before: before ? { status: before.status } : null,
    after: { status },
  });
  return Response.json({ ok: true, restaurantId, status });
}
