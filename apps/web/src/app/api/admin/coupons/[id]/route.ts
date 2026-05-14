/**
 * PATCH /api/admin/coupons/[id]  – edit a coupon (must belong to caller's restaurant)
 * DELETE /api/admin/coupons/[id] – soft delete: flip isActive=false
 *
 * Every change captures before/after into the audit log.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

const Patch = z.object({
  code: z.string().min(2).max(40).optional(),
  description: z.string().max(500).nullable().optional(),
  flatOff: z.number().nullable().optional(),
  percentOff: z.number().nullable().optional(),
  minOrderAmount: z.number().nullable().optional(),
  maxDiscount: z.number().nullable().optional(),
  usageLimit: z.number().int().nullable().optional(),
  perUserLimit: z.number().int().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  isActive: z.boolean().optional()
});

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireRestaurant();
  const session = await auth();

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Coupon not found', { status: 404 });

  const data = Patch.parse(await req.json());

  const patch: any = {};
  if (data.code !== undefined) patch.code = data.code.trim().toUpperCase();
  if (data.description !== undefined) patch.description = data.description;
  if (data.flatOff !== undefined) patch.flatOff = data.flatOff != null ? (data.flatOff as any) : null;
  if (data.percentOff !== undefined) patch.percentOff = data.percentOff;
  if (data.minOrderAmount !== undefined) patch.minOrderAmount = data.minOrderAmount != null ? (data.minOrderAmount as any) : null;
  if (data.maxDiscount !== undefined) patch.maxDiscount = data.maxDiscount != null ? (data.maxDiscount as any) : null;
  if (data.usageLimit !== undefined) patch.usageLimit = data.usageLimit;
  if (data.perUserLimit !== undefined) patch.perUserLimit = data.perUserLimit;
  if (data.validFrom !== undefined) patch.validFrom = data.validFrom ? new Date(data.validFrom) : new Date();
  if (data.validTo !== undefined) patch.validTo = data.validTo ? new Date(data.validTo) : null;
  if (data.isActive !== undefined) patch.isActive = data.isActive;

  const updated = await prisma.coupon.update({ where: { id }, data: patch });

  await audit('coupon.update', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'Coupon',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await requireRestaurant();
  const session = await auth();

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Coupon not found', { status: 404 });

  const updated = await prisma.coupon.update({ where: { id }, data: { isActive: false } });

  await audit('coupon.delete', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'Coupon',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json({ ok: true });
}

async function fetchOwned(couponId: string, restaurantId: string) {
  const c = await prisma.coupon.findUnique({ where: { id: couponId }, include: { branch: { select: { restaurantId: true } } } });
  if (!c || !c.branch || c.branch.restaurantId !== restaurantId) return null;
  return c;
}

function serialise<T extends Record<string, any>>(obj: T) {
  return JSON.parse(JSON.stringify(obj));
}
