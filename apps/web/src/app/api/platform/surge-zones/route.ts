/**
 * Surge zones — geofenced pay-multiplier areas.
 *   GET  — list all zones (newest first).
 *   POST — create a zone.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { requireCapability } from '@/server/tenancy';
import { auth } from '@/server/auth';
import { audit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function serialize(z: any) {
  return {
    id: z.id,
    name: z.name,
    label: z.label,
    centerLat: z.centerLat,
    centerLng: z.centerLng,
    radiusKm: z.radiusKm,
    multiplier: z.multiplier,
    isActive: z.isActive,
    activeFrom: z.activeFrom,
    activeTo: z.activeTo,
    createdAt: z.createdAt
  };
}

export async function GET() {
  await requireCapability('ops:read');
  const zones = await prisma.surgeZone.findMany({ orderBy: { createdAt: 'desc' } });
  return Response.json({ zones: zones.map(serialize) });
}

const CreateBody = z.object({
  name: z.string().min(2).max(120),
  label: z.string().max(60).optional(),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusKm: z.number().min(0.1).max(50),
  multiplier: z.number().min(1).max(5),
  isActive: z.boolean().optional(),
  activeFrom: z.string().datetime().optional().nullable(),
  activeTo: z.string().datetime().optional().nullable()
});

export async function POST(req: NextRequest) {
  await requireCapability('ops:write');
  const session = await auth();
  const data = CreateBody.parse(await req.json());

  const created = await prisma.surgeZone.create({
    data: {
      name: data.name,
      label: data.label ?? 'Busy area',
      centerLat: data.centerLat,
      centerLng: data.centerLng,
      radiusKm: data.radiusKm,
      multiplier: data.multiplier,
      isActive: data.isActive ?? true,
      activeFrom: data.activeFrom ? new Date(data.activeFrom) : null,
      activeTo: data.activeTo ? new Date(data.activeTo) : null
    }
  });

  await audit('surge.zone.create', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'SurgeZone',
    entityId: created.id,
    after: serialize(created),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(serialize(created), { status: 201 });
}
