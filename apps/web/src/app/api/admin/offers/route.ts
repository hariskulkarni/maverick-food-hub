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
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { audit } from '@/server/audit';
import { optionalString, parseOrJsonError } from '@/server/zod-helpers';

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
const FulfillmentType = z.enum(['DELIVERY', 'PICKUP', 'DINE_IN']);
const ScheduleRow = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440)
});

const Body = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).nullable().optional(),
  type: OfferType,
  code: optionalString(40).nullable(),
  percentOff: z.number().nullable().optional(),
  flatOff: z.number().nullable().optional(),
  maxDiscount: z.number().nullable().optional(),
  minOrderAmount: z.number().nullable().optional(),
  rewardConfig: z.any().nullable().optional(),
  // Presentation + targeting (BOGO + promo banners)
  imageUrl: z.union([z.string().max(2048), z.literal(''), z.null()]).optional(),
  fulfillmentScope: z.array(FulfillmentType).optional(),
  schedules: z.array(ScheduleRow).optional(),
  restaurantId: z.string().optional(),
  branchId: z.string().nullable().optional(),
  categoryIds: z.array(z.string()).optional(),
  // The editor historically sent `itemIds`; accept both (alias) so per-item
  // scopes are no longer silently dropped.
  menuItemIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
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
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const r = await requireRestaurant();

  const offers = await prisma.offer.findMany({
    where: { restaurantId: r.id },
    include: {
      appliesToCategories: true,
      appliesToItems: true,
      schedules: true,
      _count: { select: { redemptions: true } }
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }]
  });

  return Response.json({ offers });
}

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const session = gate;
  const r = await requireRestaurant();

  const parsed = parseOrJsonError(Body, await req.json());
  if (parsed instanceof Response) return parsed;
  const data = parsed;
  // Editor sends `itemIds`; older callers `menuItemIds`. Accept either.
  const menuItemIds = data.menuItemIds ?? data.itemIds ?? [];

  const restaurantId = data.restaurantId ?? r.id;
  if (restaurantId !== r.id) {
    return Response.json({ error: 'Cannot create offer for a different restaurant', reason: 'cross_tenant' }, { status: 403 });
  }

  // Validate branch (if supplied) belongs to this restaurant
  if (data.branchId) {
    const owned = await prisma.branch.findFirst({
      where: { id: data.branchId, restaurantId: r.id },
      select: { id: true }
    });
    if (!owned) return Response.json({ error: 'Branch not in this restaurant', reason: 'branch_not_owned' }, { status: 403 });
  }

  // Validate categories/items belong to this restaurant's branches
  if (data.categoryIds && data.categoryIds.length > 0) {
    const cats = await prisma.category.findMany({
      where: { id: { in: data.categoryIds }, branch: { restaurantId: r.id } },
      select: { id: true }
    });
    if (cats.length !== data.categoryIds.length) {
      return Response.json({ error: 'One or more categories do not belong to this restaurant', reason: 'category_not_owned' }, { status: 400 });
    }
  }
  if (menuItemIds.length > 0) {
    const items = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, branch: { restaurantId: r.id } },
      select: { id: true }
    });
    if (items.length !== menuItemIds.length) {
      return Response.json({ error: 'One or more menu items do not belong to this restaurant', reason: 'item_not_owned' }, { status: 400 });
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
          imageUrl: data.imageUrl ? data.imageUrl : null,
          fulfillmentScope: (data.fulfillmentScope ?? []) as any,
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
      if (menuItemIds.length > 0) {
        await tx.offerItemScope.createMany({
          data: menuItemIds.map((menuItemId) => ({ offerId: offer.id, menuItemId }))
        });
      }
      if (data.schedules && data.schedules.length > 0) {
        await tx.offerSchedule.createMany({
          data: data.schedules.map((s) => ({ offerId: offer.id, dayOfWeek: s.dayOfWeek, startMin: s.startMin, endMin: s.endMin }))
        });
      }

      return tx.offer.findUnique({
        where: { id: offer.id },
        include: { appliesToCategories: true, appliesToItems: true, schedules: true }
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
      return Response.json({ error: 'Code already in use', reason: 'duplicate_code' }, { status: 409 });
    }
    throw e;
  }
}

function serialise<T>(obj: T): any {
  return JSON.parse(JSON.stringify(obj));
}
