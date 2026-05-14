/**
 * Single-offer admin API.
 *
 *   GET    /api/admin/offers/[id] — fetch one offer (with scope joins)
 *   PATCH  /api/admin/offers/[id] — update; scope arrays replace atomically
 *   DELETE /api/admin/offers/[id] — soft delete (isActive=false). Hard-delete is
 *                                   not allowed because OfferRedemption rows
 *                                   reference back.
 *
 * Every mutation captures before/after snapshots into AuditLog.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { auth } from '@/server/auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';

export const dynamic = 'force-dynamic';

const OfferType = z.enum([
  'PERCENTAGE',
  'FIXED',
  'BUY_X_GET_Y',
  'COMBO_DISCOUNT',
  'FREE_ITEM_ABOVE',
  'FIRST_ORDER',
  'REPEAT_CUSTOMER',
  'DINE_IN_TO_ONLINE',
  'ONLINE_TO_DINE_IN'
]);

const ChannelScope = z.enum(['ANY', 'ONLINE', 'DINE_IN']);

const Patch = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  type: OfferType.optional(),
  code: z.string().min(2).max(40).nullable().optional(),
  percentOff: z.number().nullable().optional(),
  flatOff: z.number().nullable().optional(),
  maxDiscount: z.number().nullable().optional(),
  minOrderAmount: z.number().nullable().optional(),
  rewardConfig: z.any().nullable().optional(),
  branchId: z.string().nullable().optional(),
  categoryIds: z.array(z.string()).optional(),
  menuItemIds: z.array(z.string()).optional(),
  issuedChannel: ChannelScope.optional(),
  redeemChannel: ChannelScope.optional(),
  minCustomerOrders: z.number().int().min(0).optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  usageLimit: z.number().int().nullable().optional(),
  perUserLimit: z.number().int().min(1).optional(),
  priority: z.number().int().optional(),
  autoApply: z.boolean().optional(),
  stackable: z.boolean().optional(),
  isActive: z.boolean().optional()
});

async function fetchOwned(offerId: string, restaurantId: string) {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, restaurantId },
    include: { appliesToCategories: true, appliesToItems: true }
  });
  return offer;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;

  const offer = await fetchOwned(id, r.id);
  if (!offer) return new Response('Offer not found', { status: 404 });
  return Response.json(offer);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Offer not found', { status: 404 });

  const data = Patch.parse(await req.json());

  // Validate branch ownership if changing
  if (data.branchId) {
    const owned = await prisma.branch.findFirst({
      where: { id: data.branchId, restaurantId: r.id },
      select: { id: true }
    });
    if (!owned) return new Response('Branch not in this restaurant', { status: 403 });
  }
  if (data.categoryIds && data.categoryIds.length > 0) {
    const cats = await prisma.category.findMany({
      where: { id: { in: data.categoryIds }, branch: { restaurantId: r.id } },
      select: { id: true }
    });
    if (cats.length !== data.categoryIds.length) {
      return new Response('One or more categories do not belong to this restaurant', { status: 400 });
    }
  }
  if (data.menuItemIds && data.menuItemIds.length > 0) {
    const items = await prisma.menuItem.findMany({
      where: { id: { in: data.menuItemIds }, branch: { restaurantId: r.id } },
      select: { id: true }
    });
    if (items.length !== data.menuItemIds.length) {
      return new Response('One or more menu items do not belong to this restaurant', { status: 400 });
    }
  }

  const patch: any = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.type !== undefined) patch.type = data.type;
  if (data.code !== undefined) patch.code = data.code ? data.code.trim().toUpperCase() : null;
  if (data.percentOff !== undefined) patch.percentOff = data.percentOff;
  if (data.flatOff !== undefined) patch.flatOff = data.flatOff != null ? (data.flatOff as any) : null;
  if (data.maxDiscount !== undefined) patch.maxDiscount = data.maxDiscount != null ? (data.maxDiscount as any) : null;
  if (data.minOrderAmount !== undefined) patch.minOrderAmount = data.minOrderAmount != null ? (data.minOrderAmount as any) : null;
  if (data.rewardConfig !== undefined) patch.rewardConfig = data.rewardConfig ?? undefined;
  if (data.branchId !== undefined) patch.branchId = data.branchId;
  if (data.issuedChannel !== undefined) patch.issuedChannel = data.issuedChannel;
  if (data.redeemChannel !== undefined) patch.redeemChannel = data.redeemChannel;
  if (data.minCustomerOrders !== undefined) patch.minCustomerOrders = data.minCustomerOrders;
  if (data.validFrom !== undefined) patch.validFrom = data.validFrom ? new Date(data.validFrom) : new Date();
  if (data.validTo !== undefined) patch.validTo = data.validTo ? new Date(data.validTo) : null;
  if (data.usageLimit !== undefined) patch.usageLimit = data.usageLimit;
  if (data.perUserLimit !== undefined) patch.perUserLimit = data.perUserLimit;
  if (data.priority !== undefined) patch.priority = data.priority;
  if (data.autoApply !== undefined) patch.autoApply = data.autoApply;
  if (data.stackable !== undefined) patch.stackable = data.stackable;
  if (data.isActive !== undefined) patch.isActive = data.isActive;
  patch.updatedById = session?.user?.id ?? null;

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.offer.update({ where: { id }, data: patch });

      // Replace scopes atomically only if the caller sent them
      if (data.categoryIds !== undefined) {
        await tx.offerCategoryScope.deleteMany({ where: { offerId: id } });
        if (data.categoryIds.length > 0) {
          await tx.offerCategoryScope.createMany({
            data: data.categoryIds.map((categoryId) => ({ offerId: id, categoryId }))
          });
        }
      }
      if (data.menuItemIds !== undefined) {
        await tx.offerItemScope.deleteMany({ where: { offerId: id } });
        if (data.menuItemIds.length > 0) {
          await tx.offerItemScope.createMany({
            data: data.menuItemIds.map((menuItemId) => ({ offerId: id, menuItemId }))
          });
        }
      }

      return tx.offer.findUnique({
        where: { id },
        include: { appliesToCategories: true, appliesToItems: true }
      });
    });

    await audit('offer.update', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      restaurantId: r.id,
      entityType: 'Offer',
      entityId: id,
      before: serialise(before),
      after: serialise(updated),
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: req.headers.get('user-agent') ?? undefined
    });

    return Response.json(updated);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return new Response('Code already in use', { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();
  const { id } = await params;

  const before = await fetchOwned(id, r.id);
  if (!before) return new Response('Offer not found', { status: 404 });

  const updated = await prisma.offer.update({
    where: { id },
    data: { isActive: false, updatedById: session?.user?.id ?? null }
  });

  await audit('offer.deactivate', {
    actorId: session?.user?.id,
    actorRole: session?.user?.role,
    restaurantId: r.id,
    entityType: 'Offer',
    entityId: id,
    before: serialise(before),
    after: serialise(updated),
    ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: req.headers.get('user-agent') ?? undefined
  });

  return Response.json({ ok: true });
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
