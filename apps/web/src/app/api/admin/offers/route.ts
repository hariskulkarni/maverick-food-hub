/**
 * Restaurant-admin offers API.
 *
 *   POST /api/admin/offers — create a new Offer (with category/item scope rows).
 *   GET  /api/admin/offers — list this restaurant's offers + recent redemption counts.
 *
 * Offers are richer than Coupons (9 promotion types, scope joins, channel
 * cross-pollination). Both systems coexist; see prisma/schema.prisma for the
 * `Offer` model docstring.
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

const Body = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  type: OfferType,
  code: z.string().min(2).max(40).nullable().optional(),
  percentOff: z.number().nullable().optional(),
  flatOff: z.number().nullable().optional(),
  maxDiscount: z.number().nullable().optional(),
  minOrderAmount: z.number().nullable().optional(),
  rewardConfig: z.any().nullable().optional(),
  restaurantId: z.string().optional(),
  branchId: z.string().nullable().optional(),
  categoryIds: z.array(z.string()).optional(),
  menuItemIds: z.array(z.string()).optional(),
  issuedChannel: ChannelScope.optional(),
  redeemChannel: ChannelScope.optional(),
  minCustomerOrders: z.number().int().min(0).optional(),
  validFrom: z.string().optional().nullable(),
  validTo: z.string().nullable().optional(),
  usageLimit: z.number().int().nullable().optional(),
  perUserLimit: z.number().int().min(1).optional(),
  priority: z.number().int().optional(),
  autoApply: z.boolean().optional(),
  stackable: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();

  const offers = await prisma.offer.findMany({
    where: { restaurantId: r.id },
    include: {
      appliesToCategories: true,
      appliesToItems: true,
      _count: { select: { redemptions: true } }
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });

  return Response.json({ offers });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (session?.user?.role !== 'ADMIN') return new Response('Forbidden', { status: 403 });
  const r = await requireRestaurant();

  const data = Body.parse(await req.json());

  const restaurantId = data.restaurantId ?? r.id;
  if (restaurantId !== r.id) {
    return new Response('Cannot create offer for a different restaurant', { status: 403 });
  }

  // Validate branch (if supplied) belongs to this restaurant
  if (data.branchId) {
    const owned = await prisma.branch.findFirst({
      where: { id: data.branchId, restaurantId: r.id },
      select: { id: true }
    });
    if (!owned) return new Response('Branch not in this restaurant', { status: 403 });
  }

  // Validate categories/items belong to this restaurant's branches
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

  const code = data.code ? data.code.trim().toUpperCase() : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const offer = await tx.offer.create({
        data: {
          name: data.name,
          description: data.description ?? null,
          type: data.type,
          code,
          percentOff: data.percentOff ?? null,
          flatOff: data.flatOff != null ? (data.flatOff as any) : null,
          maxDiscount: data.maxDiscount != null ? (data.maxDiscount as any) : null,
          minOrderAmount: data.minOrderAmount != null ? (data.minOrderAmount as any) : null,
          rewardConfig: data.rewardConfig ?? undefined,
          restaurantId,
          branchId: data.branchId ?? null,
          issuedChannel: data.issuedChannel ?? 'ANY',
          redeemChannel: data.redeemChannel ?? 'ANY',
          minCustomerOrders: data.minCustomerOrders ?? 0,
          validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
          validTo: data.validTo ? new Date(data.validTo) : null,
          usageLimit: data.usageLimit ?? null,
          perUserLimit: data.perUserLimit ?? 1,
          priority: data.priority ?? 0,
          autoApply: data.autoApply ?? false,
          stackable: data.stackable ?? false,
          isActive: data.isActive ?? true,
          createdById: session?.user?.id ?? null
        }
      });

      if (data.categoryIds && data.categoryIds.length > 0) {
        await tx.offerCategoryScope.createMany({
          data: data.categoryIds.map((categoryId) => ({ offerId: offer.id, categoryId }))
        });
      }
      if (data.menuItemIds && data.menuItemIds.length > 0) {
        await tx.offerItemScope.createMany({
          data: data.menuItemIds.map((menuItemId) => ({ offerId: offer.id, menuItemId }))
        });
      }

      return tx.offer.findUnique({
        where: { id: offer.id },
        include: { appliesToCategories: true, appliesToItems: true }
      });
    });

    await audit('offer.create', {
      actorId: session?.user?.id,
      actorRole: session?.user?.role,
      restaurantId: r.id,
      entityType: 'Offer',
      entityId: created?.id ?? null,
      after: serialise(created),
      ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: req.headers.get('user-agent') ?? undefined
    });

    return Response.json(created);
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return new Response('Code already in use', { status: 409 });
    }
    throw e;
  }
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
