/**
 * Rider incentive slab — single-row mutations.
 *   PATCH  — update any subset of fields (incl. toggle isActive).
 *   DELETE — hard-delete the slab (cascades RiderIncentiveProgress).
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(i: any) {
  return {
    id: i.id,
    title: i.title,
    description: i.description,
    period: i.period,
    targetDeliveries: i.targetDeliveries,
    bonusAmount: Number(i.bonusAmount),
    startsAt: i.startsAt,
    endsAt: i.endsAt,
    isActive: i.isActive,
    createdAt: i.createdAt
  };
}

const PatchBody = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  period: z.enum(['DAILY', 'WEEKLY']).optional(),
  targetDeliveries: z.number().int().min(1).max(1000).optional(),
  bonusAmount: z.number().min(0).max(100_000).optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());

  const before = await prisma.riderIncentive.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  const patch: any = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.description !== undefined) patch.description = data.description;
  if (data.period !== undefined) patch.period = data.period;
  if (data.targetDeliveries !== undefined) patch.targetDeliveries = data.targetDeliveries;
  if (data.bonusAmount !== undefined) patch.bonusAmount = data.bonusAmount as any;
  if (data.startsAt !== undefined) patch.startsAt = data.startsAt ? new Date(data.startsAt) : new Date();
  if (data.endsAt !== undefined) patch.endsAt = data.endsAt ? new Date(data.endsAt) : null;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const after = await prisma.riderIncentive.update({ where: { id }, data: patch });

  await audit('rider.incentive.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderIncentive',
    entityId: id,
    before: serialize(before),
    after: serialize(after),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(serialize(after));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;

  const before = await prisma.riderIncentive.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  await prisma.riderIncentive.delete({ where: { id } });

  await audit('rider.incentive.delete', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderIncentive',
    entityId: id,
    before: serialize(before),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({ ok: true });
}
