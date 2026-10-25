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
import { tenantAdminOrError } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { optionalString, parseOrJsonError } from '@/server/zod-helpers';
import { couponNumbers, CODE_TAKEN } from '../_schema';

const Patch = z.object({
  code: optionalString(40),
  description: z.string().max(500).nullable().optional(),
  ...couponNumbers,
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  isActive: z.boolean().optional()
});

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await tenantAdminOrError();
  if (r instanceof Response) return r;
  const session = await auth();

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Coupon not found', { status: 404 });

  const data = parseOrJsonError(Patch, await req.json().catch(() => null));
  if (data instanceof Response) return data;

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

  // The edited coupon must still discount something.
  const nextFlat = patch.flatOff !== undefined ? patch.flatOff : before.flatOff;
  const nextPct = patch.percentOff !== undefined ? patch.percentOff : before.percentOff;
  if (!(Number(nextFlat ?? 0) > 0) && !(Number(nextPct ?? 0) > 0)) {
    return Response.json({ error: 'Provide a flat or percent discount.', reason: 'no_discount' }, { status: 400 });
  }
  if (patch.code && patch.code !== before.code) {
    const clash = await prisma.coupon.findUnique({ where: { code: patch.code }, select: { id: true } });
    if (clash) return Response.json(CODE_TAKEN, { status: 409 });
  }

  let updated;
  try {
    updated = await prisma.coupon.update({ where: { id }, data: patch });
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') return Response.json(CODE_TAKEN, { status: 409 });
    throw e;
  }

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
  const r = await tenantAdminOrError();
  if (r instanceof Response) return r;
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
