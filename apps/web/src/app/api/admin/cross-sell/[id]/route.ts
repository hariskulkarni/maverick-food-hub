/**
 * PATCH  /api/admin/cross-sell/[id] — edit a cross-sell row
 * DELETE /api/admin/cross-sell/[id] — hard delete a cross-sell row (no FKs reference it)
 *
 * Tenancy: the cross-sell's parent item must belong to a branch of the caller's
 * restaurant. Mutations are audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

const Patch = z.object({
  sortOrder: z.number().int().optional(),
  surface: z.string().max(40).optional(),
  note: z.string().max(500).nullable().optional(),
  source: z.string().max(40).optional(),
  isActive: z.boolean().optional()
});

async function fetchOwned(id: string, restaurantId: string) {
  return prisma.crossSell.findFirst({
    where: { id, parentItem: { branch: { restaurantId } } },
    include: {
      parentItem: { select: { id: true, name: true, branchId: true } },
      suggestedItem: { select: { id: true, name: true, branchId: true } }
    }
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;
  const row = await fetchOwned(id, r.id);
  if (!row) return new Response('Not found', { status: 404 });
  return Response.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Not found', { status: 404 });

  const data = Patch.parse(await req.json());
  const patch: any = {};
  if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
  if (data.surface !== undefined) patch.surface = data.surface;
  if (data.note !== undefined) patch.note = data.note;
  if (data.source !== undefined) patch.source = data.source;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const updated = await prisma.crossSell.update({ where: { id }, data: patch });

  await audit('crosssell.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'CrossSell',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Not found', { status: 404 });

  await prisma.crossSell.delete({ where: { id } });

  await audit('crosssell.delete', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'CrossSell',
    entityId: id,
    before: serialise(before),
    after: null,
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json({ ok: true });
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
