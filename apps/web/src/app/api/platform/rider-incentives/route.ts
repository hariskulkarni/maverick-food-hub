/**
 * Rider incentive slabs — "complete N deliveries in a period → flat bonus".
 *   GET  — list all slabs (newest first).
 *   POST — create a slab.
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

export async function GET() {
  await requireSuperAdmin();
  const incentives = await prisma.riderIncentive.findMany({ orderBy: { createdAt: 'desc' } });
  return Response.json({ incentives: incentives.map(serialize) });
}

const CreateBody = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  period: z.enum(['DAILY', 'WEEKLY']),
  targetDeliveries: z.number().int().min(1).max(1000),
  bonusAmount: z.number().min(0).max(100_000),
  startsAt: z.string().datetime().optional().nullable(),
  endsAt: z.string().datetime().optional().nullable(),
  isActive: z.boolean().optional()
});

export async function POST(req: NextRequest) {
  await requireSuperAdmin();
  const session = await auth();
  const data = CreateBody.parse(await req.json());

  const created = await prisma.riderIncentive.create({
    data: {
      title: data.title,
      description: data.description ?? null,
      period: data.period,
      targetDeliveries: data.targetDeliveries,
      bonusAmount: data.bonusAmount as any,
      startsAt: data.startsAt ? new Date(data.startsAt) : new Date(),
      endsAt: data.endsAt ? new Date(data.endsAt) : null,
      isActive: data.isActive ?? true
    }
  });

  await audit('rider.incentive.create', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    entityType: 'RiderIncentive',
    entityId: created.id,
    after: serialize(created),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(serialize(created), { status: 201 });
}
