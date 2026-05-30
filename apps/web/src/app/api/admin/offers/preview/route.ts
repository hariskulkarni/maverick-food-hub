/**
 * POST /api/admin/offers/preview
 *
 * Lets an admin try an unsaved offer against a synthetic cart so they can see
 * exactly how much it would discount before they hit save. The handler builds
 * an in-memory OfferRow from the draft payload and runs the pure
 * `evaluateOffer` resolver — no DB writes.
 *
 * Body:
 *   {
 *     draft: { ...offer fields... },
 *     cart:  [{ menuItemId, categoryId?, unitPrice, quantity }],
 *     customerOrderCount?: number   // for FIRST_ORDER / REPEAT_CUSTOMER gates
 *   }
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireRestaurantAdminApi } from '@/server/api-auth';
import { requireRestaurant } from '@/server/tenancy';
import { evaluateOffer, type OfferRow, type OfferContext } from '@/server/offers';

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

const Draft = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: OfferType,
  code: z.string().nullable().optional(),
  percentOff: z.number().nullable().optional(),
  flatOff: z.number().nullable().optional(),
  maxDiscount: z.number().nullable().optional(),
  minOrderAmount: z.number().nullable().optional(),
  rewardConfig: z.any().nullable().optional(),
  restaurantId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  categoryIds: z.array(z.string()).optional(),
  menuItemIds: z.array(z.string()).optional(),
  issuedChannel: ChannelScope.optional(),
  redeemChannel: ChannelScope.optional(),
  minCustomerOrders: z.number().int().optional(),
  validFrom: z.string().optional().nullable(),
  validTo: z.string().nullable().optional(),
  usageLimit: z.number().int().nullable().optional(),
  usedCount: z.number().int().optional(),
  perUserLimit: z.number().int().optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().optional(),
  autoApply: z.boolean().optional(),
  stackable: z.boolean().optional()
});

const CartLine = z.object({
  menuItemId: z.string(),
  categoryId: z.string().nullable().optional(),
  unitPrice: z.number(),
  quantity: z.number().int().min(1)
});

const Shape = z.object({
  draft: Draft,
  cart: z.array(CartLine),
  customerOrderCount: z.number().int().min(0).optional(),
  channel: z.enum(['ONLINE', 'DINE_IN']).optional(),
  branchId: z.string().nullable().optional()
});

// Version-tolerant preprocessor. An older client build nested the cart array +
// sibling fields under `cart` as an object (e.g. { draft, cart: { cart: [...],
// channel, branchId } }). During any deploy window a stale tab can still POST
// that shape; rather than 500 with a ZodError stack, we normalise it to the
// flat shape so the preview keeps working for old and new clients alike.
const Body = z.preprocess((val: any) => {
  if (val && typeof val === 'object' && val.cart && !Array.isArray(val.cart) && typeof val.cart === 'object') {
    const nested = val.cart;
    const lines = nested.cart ?? nested.items ?? nested.lines;
    return {
      ...val,
      cart: Array.isArray(lines) ? lines : [],
      channel: val.channel ?? nested.channel,
      branchId: val.branchId ?? nested.branchId,
      customerOrderCount: val.customerOrderCount ?? nested.customerOrderCount
    };
  }
  return val;
}, Shape);

export async function POST(req: NextRequest) {
  const gate = await requireRestaurantAdminApi();
  if (gate instanceof Response) return gate;
  const r = await requireRestaurant();

  const data = Body.parse(await req.json());
  const { draft, cart } = data;

  // Build a synthetic OfferRow (no DB persistence)
  const offer: OfferRow = {
    id: draft.id ?? 'preview',
    name: draft.name ?? 'Preview',
    type: draft.type as any,
    code: draft.code ?? null,
    percentOff: draft.percentOff ?? null,
    flatOff: draft.flatOff ?? null,
    maxDiscount: draft.maxDiscount ?? null,
    minOrderAmount: draft.minOrderAmount ?? null,
    rewardConfig: draft.rewardConfig ?? null,
    restaurantId: draft.restaurantId ?? r.id,
    branchId: draft.branchId ?? null,
    appliesToCategories: (draft.categoryIds ?? []).map((categoryId) => ({ categoryId })),
    appliesToItems: (draft.menuItemIds ?? []).map((menuItemId) => ({ menuItemId })),
    issuedChannel: (draft.issuedChannel ?? 'ANY') as any,
    redeemChannel: (draft.redeemChannel ?? 'ANY') as any,
    minCustomerOrders: draft.minCustomerOrders ?? 0,
    validFrom: draft.validFrom ? new Date(draft.validFrom) : new Date(Date.now() - 1000),
    validTo: draft.validTo ? new Date(draft.validTo) : null,
    usageLimit: draft.usageLimit ?? null,
    usedCount: draft.usedCount ?? 0,
    perUserLimit: draft.perUserLimit ?? 1,
    isActive: draft.isActive ?? true,
    priority: draft.priority ?? 0,
    autoApply: draft.autoApply ?? false,
    stackable: draft.stackable ?? false
  };

  const subtotal = cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const ctx: OfferContext = {
    cart: cart.map((l) => ({ ...l, categoryId: l.categoryId ?? null })),
    subtotal,
    channel: data.channel ?? 'ONLINE',
    branchId: data.branchId ?? draft.branchId ?? null,
    restaurantId: r.id,
    customerOrderCount: data.customerOrderCount ?? 0,
    customerRedemptionsForOffer: 0
  };

  const result = evaluateOffer(offer, ctx);
  return Response.json({ subtotal, result });
}
