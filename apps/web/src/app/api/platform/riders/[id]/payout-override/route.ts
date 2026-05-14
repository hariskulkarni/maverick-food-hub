/**
 * Per-rider payout override CRUD.
 *
 *  GET    → returns the currently active override (or null) plus the platform
 *           default rule so the UI can render the merged "effective" rule
 *           alongside the explicit overrides.
 *  PUT    → upsert (idempotent: deactivates any prior active override for this
 *           rider, then inserts a fresh row). Every field is optional — a
 *           field missing from the body inherits from the platform default.
 *  DELETE → deactivate (sets isActive=false + effectiveTo=now). Past
 *           assignments keep their already-paid amount; future deliveries
 *           revert to the platform default.
 *
 * All mutations are audited.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import { requireSuperAdmin } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { getEffectivePayoutRule } from '@/server/payouts';

// Optional, nullable Decimals — null/undefined ⇒ inherit. Zod `.nullish()`
// covers both, so the client can clear an override field by sending `null`.
const Money = z.number().min(0).max(100_000).nullish();
const Body = z.object({
  basePay:        Money,
  perKmRate:      Money,
  minPayout:      Money,
  maxPayout:      Money,
  codHandlingFee: Money,
  notes:         z.string().max(500).optional().nullable(),
  effectiveFrom: z.string().datetime().optional().nullable(),
  effectiveTo:   z.string().datetime().optional().nullable()
}).refine(
  (v) => v.basePay != null || v.perKmRate != null || v.minPayout != null || v.maxPayout != null || v.codHandlingFee != null,
  { message: 'At least one override field must be set' }
);

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireSuperAdmin();
  const { id } = await params;
  const rider = await prisma.riderProfile.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, phone: true } } }
  });
  if (!rider) return new Response('Rider not found', { status: 404 });

  const effective = await getEffectivePayoutRule(id);
  // History: last 10 overrides for this rider so admins can see who changed what.
  const history = await prisma.riderPayoutOverride.findMany({
    where: { riderId: id },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  return Response.json({
    rider: { id: rider.id, name: rider.user.name, phone: rider.user.phone },
    override: effective.override,        // currently-active override row or null
    platformRule: effective.platformRule, // currently-active DeliveryPayoutRule
    source: effective.source,             // 'rider' | 'platform'
    history
  });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;
  const data = Body.parse(await req.json());

  const rider = await prisma.riderProfile.findUnique({ where: { id } });
  if (!rider) return new Response('Rider not found', { status: 404 });

  const before = await prisma.riderPayoutOverride.findFirst({
    where: { riderId: id, isActive: true }
  });

  const overrideRow = await prisma.$transaction(async (tx) => {
    // Deactivate any currently-active override(s) for this rider so the
    // (riderId, isActive=true) invariant holds even without a DB-level
    // partial unique index.
    if (before) {
      await tx.riderPayoutOverride.updateMany({
        where: { riderId: id, isActive: true },
        data: { isActive: false, effectiveTo: new Date(), updatedById: session.user.id }
      });
    }
    return tx.riderPayoutOverride.create({
      data: {
        riderId: id,
        isActive: true,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
        effectiveTo:   data.effectiveTo   ? new Date(data.effectiveTo)   : null,
        basePay:        data.basePay        == null ? null : (data.basePay        as any),
        perKmRate:      data.perKmRate      == null ? null : (data.perKmRate      as any),
        minPayout:      data.minPayout      == null ? null : (data.minPayout      as any),
        maxPayout:      data.maxPayout      == null ? null : (data.maxPayout      as any),
        codHandlingFee: data.codHandlingFee == null ? null : (data.codHandlingFee as any),
        notes: data.notes ?? null,
        createdById: session.user.id,
        updatedById: session.user.id
      }
    });
  });

  await audit(before ? 'rider.payout.override.update' : 'rider.payout.override.create', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'RiderPayoutOverride',
    entityId: overrideRow.id,
    before,
    after: overrideRow,
    ipAddress: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json(overrideRow);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSuperAdmin();
  const { id } = await params;

  const before = await prisma.riderPayoutOverride.findFirst({ where: { riderId: id, isActive: true } });
  if (!before) return new Response('No active override to deactivate', { status: 404 });

  const after = await prisma.riderPayoutOverride.update({
    where: { id: before.id },
    data: { isActive: false, effectiveTo: new Date(), updatedById: session.user.id }
  });

  await audit('rider.payout.override.deactivate', {
    actorId: session.user.id,
    actorRole: session.user.role,
    entityType: 'RiderPayoutOverride',
    entityId: before.id,
    before,
    after,
    ipAddress: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent') ?? null
  });

  return Response.json({ ok: true, override: after });
}
