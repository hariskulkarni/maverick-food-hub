/**
 * Surge zone — single-row mutations.
 *   PATCH  — update any subset of fields (incl. toggle isActive).
 *   DELETE — hard-delete the zone.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';
import { optionalString } from '@/server/zod-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(zone: any) {
  return {
    id: zone.id,
    name: zone.name,
    label: zone.label,
    centerLat: zone.centerLat,
    centerLng: zone.centerLng,
    radiusKm: zone.radiusKm,
    multiplier: zone.multiplier,
    isActive: zone.isActive,
    activeFrom: zone.activeFrom,
    activeTo: zone.activeTo,
    createdAt: zone.createdAt
  };
}

const PatchBody = z.object({
  name: optionalString(120),
  label: z.string().max(60).optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().min(0.1).max(50).optional(),
  multiplier: z.number().min(1).max(5).optional(),
  isActive: z.boolean().optional(),
  activeFrom: z.string().datetime().nullable().optional(),
  activeTo: z.string().datetime().nullable().optional()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const session = await auth();
  const { id } = await params;
  const data = PatchBody.parse(await req.json());

  const before = await prisma.surgeZone.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.label !== undefined) patch.label = data.label;
  if (data.centerLat !== undefined) patch.centerLat = data.centerLat;
  if (data.centerLng !== undefined) patch.centerLng = data.centerLng;
  if (data.radiusKm !== undefined) patch.radiusKm = data.radiusKm;
  if (data.multiplier !== undefined) patch.multiplier = data.multiplier;
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  if (data.activeFrom !== undefined) patch.activeFrom = data.activeFrom ? new Date(data.activeFrom) : null;
  if (data.activeTo !== undefined) patch.activeTo = data.activeTo ? new Date(data.activeTo) : null;

  const after = await prisma.surgeZone.update({ where: { id }, data: patch });

  await audit('surge.zone.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'SurgeZone',
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

  const before = await prisma.surgeZone.findUnique({ where: { id } });
  if (!before) return new Response('Not found', { status: 404 });

  await prisma.surgeZone.delete({ where: { id } });

  await audit('surge.zone.delete', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'SurgeZone',
    entityId: id,
    before: serialize(before),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({ ok: true });
}
